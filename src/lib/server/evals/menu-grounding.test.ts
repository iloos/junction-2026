/**
 * Grounded menu (evals/menu/grounding-check.ts): each golden brief (evals/briefs/golden.json) is answered through
 * /request and its menu proposed, then every dish is grounded by web/grounding.ts (`startGrounding`, the path
 * `groundMenuInBackground` takes) against cited recipes: Exa through make-in-house, replayed from
 * web/fixtures/exa.json here. Every dish ends `done` with a note; compared recipes are real pages; a match really
 * shares half the ingredients; grounding never changes the menu. Across the briefs at least one dish must match a
 * recorded recipe, so the eval exercises real matches, not only honest "no recipe" answers.
 *
 * Record (live Exa, ≤ 30 calls, ~$0.007 each; answers are merged into web/fixtures/exa.json under `outside:<dish>`):
 *   GROUND_RECORD=1 DATABASE_URL= node --env-file=.env node_modules/vitest/vitest.mjs run --project server \
 *     src/lib/server/evals/menu-grounding.test.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { scenarioDate } from '$lib/core/scenario';
import type { BriefAnswer, BriefField } from '$lib/ui/request/types';
import { checkGrounding, type GroundingState } from '../../../../evals/menu/grounding-check';
import { trialWorkspace } from '../agent/trial-harness';
import { runRequest } from '../request/run';
import { toEventBrief } from '../menu/brief';
import { proposeForBrief } from '../menu/flow';
import { groundingFor, resetGrounding, startGrounding } from '../web/grounding';
import { createFixtureFactSearch } from '../web/fixture';
import { createFindings } from '../web/findings';
import { createExa, type FactSearch } from '../web/exa';
import { createWebHttp } from '../web/http';

interface Brief {
	id: string;
	kitchen: string;
	text: string;
	answers: Partial<Record<BriefField, BriefAnswer['value']>>;
}
const briefs = (
	JSON.parse(readFileSync(join(process.cwd(), 'evals', 'briefs', 'golden.json'), 'utf-8')) as {
		briefs: Brief[];
	}
).briefs;

const RECORD = process.env.GROUND_RECORD === '1' && Boolean(process.env.EXA_API_KEY);
const FIXTURE = join('src', 'lib', 'server', 'web', 'fixtures', 'exa.json');
const MAX_CALLS = 30;
const recorded: Record<string, unknown> = {};

/** Live Exa that keeps each structured answer in the fixture's shape, capped at MAX_CALLS. */
function recordingExa(): FactSearch {
	const live = createExa(
		createWebHttp({
			api: 'exa',
			apiKey: process.env.EXA_API_KEY!,
			cacheDir: join('scratch', 'web-cache', 'exa')
		})
	);
	let calls = 0;
	return {
		...live,
		async structured(q) {
			if (++calls > MAX_CALLS) throw new Error(`recording stopped at ${MAX_CALLS} calls`);
			const r = await live.structured(q);
			recorded[q.key] = {
				content: r.content,
				grounding: r.grounding,
				results: r.results,
				at: r.at,
				...(r.costUsd !== undefined ? { costUsd: r.costUsd } : {})
			};
			return r;
		}
	};
}

let matched = 0;
afterAll(() => {
	if (!RECORD || !Object.keys(recorded).length) return;
	const fx = JSON.parse(readFileSync(FIXTURE, 'utf-8')) as { answers: Record<string, unknown> };
	fx.answers = { ...fx.answers, ...recorded };
	writeFileSync(FIXTURE, JSON.stringify(fx, null, '\t') + '\n');
	console.log(`recorded ${Object.keys(recorded).length} answers into ${FIXTURE}`);
});

describe('suite: grounded menu', () => {
	const exa = RECORD ? recordingExa() : createFixtureFactSearch();
	for (const b of briefs)
		it(b.id, { timeout: 300_000 }, async () => {
			const w = await trialWorkspace();
			const today = scenarioDate(w.env.ports.clock.now());
			const kitchen = (await w.env.ports.store.kitchens(w.env.workspaceId)).find(
				(k) => k.id === b.kitchen
			)!;
			const given: BriefAnswer[] = [];
			const ask = () =>
				runRequest(b.text, {
					handlers: w.handlers,
					ctx: w.ctx('chef'),
					today,
					kitchen,
					llm: null,
					llmKind: 'fixture',
					place: true,
					briefAnswers: given
				});
			let r = await ask();
			for (let round = 0; r.event?.question && round < 8; round++) {
				const value = b.answers[r.event.question.field];
				if (value === undefined) break;
				given.push({ id: r.event.question.id, value });
				r = await ask();
			}
			const d = r.event?.draft;
			expect(d && !r.event?.question, 'brief complete').toBeTruthy();
			const md = {
				workspaceId: w.env.workspaceId,
				store: w.env.ports.menus!,
				catalog: w.env.ports.catalog,
				now: () => w.env.ports.clock.now()
			};
			const view = await proposeForBrief(md, {
				kitchenId: b.kitchen,
				brief: toEventBrief(d!, b.text)!
			});
			const p = view.proposal;
			const before = JSON.stringify(p);
			resetGrounding();
			await startGrounding(
				p.dishes.map((x) => ({
					name: x.name,
					ingredients: x.ingredients.map((i) => ({
						label: i.label,
						...(i.productId ? { productId: i.productId } : {})
					}))
				})),
				{ exa, catalog: w.env.ports.catalog, findings: createFindings(undefined, true) }
			);
			const g = groundingFor(p.dishes) as Record<string, GroundingState>;
			const after = JSON.stringify(await md.store.get(md.workspaceId, p.id, p.revision));
			const results = checkGrounding(b.id, p, g, { before, after });
			const done = Object.values(g).filter((x) => x.state === 'done');
			const hit = done.filter((x) => x.state === 'done' && x.matchedSources.length > 0);
			matched += hit.length;
			console.log(
				`${b.id}: ${done.length}/${p.dishes.length} grounded, ${hit.length} matched (${hit.map((x) => x.dishName).join(', ') || 'none'})`
			);
			expect(results.filter((x) => !x.pass)).toEqual([]);
		});

	it('at least one dish matches a recorded recipe', () => {
		expect(matched, 'record the golden briefs: GROUND_RECORD=1 (see the header)').toBeGreaterThan(
			0
		);
	});
});
