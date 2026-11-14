/**
 * Golden open-event briefs (evals/briefs/golden.json) through the real /request path on PGlite: the chef's words,
 * every brief question answered from the case (by the question's field, never its position), then whatever the
 * menu track plans. Checked now: the brief keeps guests, date, courses and every typed diet. Checked once A4 lands
 * (expectFail until then): a held plan exists for the event, every course is a dish, no explicit diet was dropped
 * and every unresolved ingredient is shown, never silently missing.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scenarioDate } from '$lib/core/scenario';
import type { BriefAnswer, BriefField } from '$lib/ui/request/types';
import { applyExpectFail } from '../../../../evals/check';
import type { CheckResult } from '../../../../evals/types';
import { trialWorkspace } from '../agent/trial-harness';
import { runRequest } from '../request/run';

interface Brief {
	id: string;
	kitchen: string;
	text: string;
	answers: Partial<Record<BriefField, BriefAnswer['value']>>;
	expect: {
		guests: number;
		date: string;
		courses?: number;
		dietary: string[];
		plan: { dishesAtLeast: number };
	};
	expectFail?: Record<string, string[]>;
}

const briefs = (
	JSON.parse(readFileSync(join(process.cwd(), 'evals', 'briefs', 'golden.json'), 'utf-8')) as {
		briefs: Brief[];
	}
).briefs;
const MAX_ROUNDS = 8;

describe('golden event briefs', () => {
	for (const b of briefs)
		it(b.id, { timeout: 120_000 }, async () => {
			const w = await trialWorkspace();
			const today = scenarioDate(w.env.ports.clock.now());
			const kitchen = (await w.env.ports.store.kitchens(w.env.workspaceId)).find(
				(k) => k.id === b.kitchen
			)!;
			const results: CheckResult[] = [];
			const given: BriefAnswer[] = [];
			let r = await runRequest(b.text, {
				handlers: w.handlers,
				ctx: w.ctx('chef'),
				today,
				kitchen,
				llm: null,
				llmKind: 'fixture',
				place: true
			});
			for (let round = 0; r.event?.question && round < MAX_ROUNDS; round++) {
				const q = r.event.question;
				const value = b.answers[q.field];
				if (value === undefined) {
					results.push({
						key: `answers.${q.field}`,
						pass: false,
						detail: `asked "${q.text}" with no answer in the case`
					});
					break;
				}
				given.push({ id: q.id, value });
				r = await runRequest(b.text, {
					handlers: w.handlers,
					ctx: w.ctx('chef'),
					today,
					kitchen,
					llm: null,
					llmKind: 'fixture',
					place: true,
					briefAnswers: given
				});
			}
			const d = r.event?.draft;
			results.push({
				key: 'event',
				pass: Boolean(d),
				detail: d ? 'classified as an event' : (r.message ?? 'not an event')
			});
			if (d) {
				results.push({
					key: 'brief.complete',
					pass: !r.event?.question,
					detail: r.event?.question?.text ?? 'complete'
				});
				results.push({
					key: 'brief.guests',
					pass: d.guests === b.expect.guests,
					detail: `${d.guests}`
				});
				results.push({ key: 'brief.date', pass: d.date === b.expect.date, detail: `${d.date}` });
				if (b.expect.courses !== undefined)
					results.push({
						key: 'brief.courses',
						pass: d.courses === b.expect.courses,
						detail: `${d.courses}`
					});
				const diets = d.dietary ?? [];
				for (const want of b.expect.dietary)
					results.push({
						key: `brief.dietary[${want}]`,
						pass: diets.some((x) => x === want || x.startsWith(`${want}:`)),
						detail: `${JSON.stringify(diets)}`
					});
			}

			// After the menu track: a held plan for this event, every course a dish, nothing silently dropped.
			const plans = Object.values((await w.state()).plans);
			const plan = plans[plans.length - 1];
			const p: string[] = [];
			if (!plan) p.push('no plan');
			else {
				if (plan.state !== 'held') p.push(`state ${plan.state}`);
				const dishes = new Set(plan.needs.map((n) => n.label)).size;
				if (dishes < b.expect.plan.dishesAtLeast)
					p.push(`${dishes} dishes < ${b.expect.plan.dishesAtLeast}`);
				const text = JSON.stringify(plan);
				for (const want of b.expect.dietary)
					if (!text.includes(want)) p.push(`diet ${want} not carried into the plan`);
				const silent = plan.needs.filter(
					(n) =>
						!plan.lines.some((l) => l.needId === n.id) &&
						!(n as { unresolved?: unknown }).unresolved
				);
				if (silent.length)
					p.push(`needs with no line and no unresolved note: ${silent.map((n) => n.label)}`);
			}
			results.push({ key: 'plan', pass: p.length === 0, detail: p.join('; ') || plan!.id });

			const final = applyExpectFail(results, b.expectFail);
			const failed = final.filter((x) => !x.pass);
			console.log(
				`${failed.length ? '✗' : '✓'} ${b.id} ${final.length - failed.length}/${final.length}` +
					failed.map((x) => `\n    ✗ ${x.key}: ${x.detail}`).join('') +
					final
						.filter((x) => x.detail.startsWith('expected-fail'))
						.map((x) => `\n    ~ ${x.key}: ${x.detail}`)
						.join('')
			);
			expect(failed).toEqual([]);
		});
});
