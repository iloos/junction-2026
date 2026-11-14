/**
 * Paraphrase set (evals/paraphrase/cases.json): several English and Finnish phrasings per intent through /request and
 * the agent. An order must give the basket of its fidelity case (date, physical amount, constraint, category); an
 * event must be read as a brief (guests, courses) and buy nothing; a read question must create no plan and no
 * receipt. Checked as properties, never a search hit. Known gaps per intent in `expectFail`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyExpectFail, checkLate } from '../../../../evals/check';
import type { CheckResult } from '../../../../evals/types';
import { cases, checkBasket, playText, type Played } from './fidelity';

interface Phrasing {
	lang: string;
	text: string;
	guests?: number;
	courses?: number;
}
interface Intent {
	id: string;
	kind: 'order' | 'event' | 'question' | 'late';
	/** Scenario clock for this intent (default: Monday 09:00, before the cut-off). */
	now?: string;
	late?: { requested: string; offer: string };
	kitchen: string;
	sameAs?: string;
	texts?: Record<string, string[]>;
	phrasings?: Phrasing[];
	expectFail?: Record<string, string[]>;
}

const intents = (
	JSON.parse(readFileSync(join(process.cwd(), 'evals', 'paraphrase', 'cases.json'), 'utf-8')) as {
		intents: Intent[];
	}
).intents;

/** Phrasings keyed `<lang>#<n>`, in file order. */
function phrasings(i: Intent): [string, Phrasing][] {
	const list =
		i.phrasings ??
		Object.entries(i.texts ?? {}).flatMap(([lang, ts]) => ts.map((text) => ({ lang, text })));
	const n: Record<string, number> = {};
	return list.map((p) => [`${p.lang}#${(n[p.lang] = (n[p.lang] ?? 0) + 1)}`, p]);
}

function check(i: Intent, key: string, p: Phrasing, path: string, r: Played): CheckResult[] {
	const k = (s: string) => `${key}.${path}.${s}`;
	if (i.kind === 'late')
		return checkLate(`${key}.${path}`, i.late!, {
			plans: r.plans,
			committedFor: r.committedFor,
			said: r.said,
			askedDate:
				/\?/.test(r.said) && /(?<!\p{L})(date|day|when|päivä|milloin)(?!\p{L})/iu.test(r.said)
		});
	if (i.kind === 'order') {
		const c = cases.find((x) => x.id === i.sameAs);
		if (!c) return [{ key: k('sameAs'), pass: false, detail: `no fidelity case ${i.sameAs}` }];
		return checkBasket(c, `${key}.${path}`, r);
	}
	const out: CheckResult[] = [
		{
			key: k('noReceipt'),
			pass: r.receipts === 0,
			detail: `${r.receipts} receipts`
		},
		{
			key: k('noPlan'),
			pass: r.plans.every((pl) => pl.lines.length === 0),
			detail:
				r.plans.map((pl) => `${pl.id}: ${pl.lines.map((l) => l.productId)}`).join('; ') || 'none'
		}
	];
	if (i.kind === 'event' && path === 'request') {
		out.push({
			key: k('event'),
			pass: Boolean(r.event),
			detail: r.event?.occasion ?? r.error ?? 'not an event'
		});
		if (p.guests !== undefined)
			out.push({
				key: k('guests'),
				pass: r.event?.guests === p.guests,
				detail: `${r.event?.guests}`
			});
		if (p.courses !== undefined)
			out.push({
				key: k('courses'),
				pass: r.event?.courses === p.courses,
				detail: `${r.event?.courses}`
			});
	}
	if (i.kind === 'question' && path === 'request')
		out.push({ key: k('notEvent'), pass: !r.event, detail: r.event?.occasion ?? 'ok' });
	return out;
}

describe('paraphrase set', () => {
	for (const i of intents)
		it(i.id, { timeout: 300_000 }, async () => {
			const results: CheckResult[] = [];
			for (const [key, p] of phrasings(i))
				for (const path of ['request', 'agent'] as const)
					results.push(
						...check(
							i,
							key,
							p,
							path,
							await playText(
								i.kitchen,
								p.text,
								path,
								`${i.id}-${key}`,
								i.now ? new Date(i.now) : undefined
							)
						)
					);
			const final = applyExpectFail(results, i.expectFail);
			const failed = final.filter((r) => !r.pass);
			const known = final.filter((r) => r.detail.startsWith('expected-fail'));
			console.log(
				`${failed.length ? '✗' : '✓'} ${i.id} ${final.length - failed.length}/${final.length}` +
					failed.map((r) => `\n    ✗ ${r.key}: ${r.detail}`).join('') +
					known.map((r) => `\n    ~ ${r.key}: ${r.detail}`).join('')
			);
			expect(failed).toEqual([]);
		});
});
