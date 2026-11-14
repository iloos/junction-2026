/* eslint-disable @typescript-eslint/no-explicit-any -- the checkpoint's module is loaded by glob until it lands */
/**
 * How much does the request judge catch? Every word-based input from the round 9–11 probes (and the earlier chat and
 * paraphrase defects) through B's checkpoint 'request.reading' (lib/server/request/reading.ts), deterministic layer
 * only (no Decide). Two columns per case:
 *  - seeded: the judge on the reading the defective parser actually produced, so a later parser fix can't hide whether
 *    the judge itself would have caught it;
 *  - live: the judge on today's rules-parser reading of the same words (reported, not asserted).
 * Each case is classed `reading` (the words were misread, the judge's job) or `downstream` (the reading was right and
 * the defect came later: substitution, resize, commit, identity), which no reading check can catch.
 * Asserted: a reading defect's seeded reading is flagged (revise or block); a downstream case's correct reading passes.
 * Reading defects the judge misses today are `it.fails` under B (OPEN), red once caught. Table: scratch/judge-recall.json.
 * Skipped until reading.ts is on this branch.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';

const mods = import.meta.glob<any>(['../request/reading.ts', '../request/parse.ts']);
const has = Object.keys(mods).length === 2;
const load = async () => ({
	reading: await mods['../request/reading.ts']!(),
	parse: await mods['../request/parse.ts']!()
});

type Item = {
	id: string;
	query: string;
	qty: number | null;
	unit: string | null;
	product: string | null;
	requirements: string[];
	unitToken?: string;
};
const item = (
	query: string,
	qty: number | null,
	unit: string | null,
	requirements: string[] = []
): Item => ({
	id: query,
	query,
	qty,
	unit,
	product: query,
	requirements
});

interface Case {
	id: string;
	origin: string;
	words: string;
	kind: 'reading' | 'downstream';
	/** The reading the defective path produced (reading defects), or the correct reading (downstream). */
	seeded: { items: Item[]; dateText?: string | null; echo?: any[] };
	note: string;
}

const CASES: Case[] = [
	{
		id: 'ml-as-packs',
		origin: 'R11-01',
		words: '250 ml lactose-free milk for Thursday',
		kind: 'reading',
		seeded: {
			items: [item('lactose-free milk', 250, 'sales', ['lactose_free'])],
			dateText: 'for Thursday'
		},
		note: '250 ml read as 250 packs'
	},
	{
		id: 'ml-joined',
		origin: 'R11-01',
		words: '250ml lactose-free milk for Thursday',
		kind: 'reading',
		seeded: {
			items: [item('lactose-free milk', 250, 'sales', ['lactose_free'])],
			dateText: 'for Thursday'
		},
		note: 'joined unit read as packs'
	},
	{
		id: 'unknown-unit',
		origin: 'R11-01',
		words: '3 oz butter for Thursday',
		kind: 'reading',
		seeded: { items: [item('butter', 3, 'sales')], dateText: 'for Thursday' },
		note: 'an unknown unit becomes packs'
	},
	{
		id: 'echo-overbuy',
		origin: 'R11-01 (after lookup)',
		words: '250 ml lactose-free milk for Thursday',
		kind: 'reading',
		seeded: {
			items: [item('lactose-free milk', 0.25, 'l', ['lactose_free'])],
			echo: [
				{
					item: 'lactose-free milk',
					asked: { value: 0.25, unit: 'l' },
					salesQty: 250,
					salesUnit: 'ST',
					perUnit: { value: 1, unit: 'l' }
				}
			]
		},
		note: 'the chosen line buys 250 l for 0.25 l'
	},
	{
		id: 'diet-mid-sentence',
		origin: 'paraphrase P1',
		words: '2 litres of milk lactose free for Thursday',
		kind: 'reading',
		seeded: { items: [item('milk', 2, 'l')], dateText: 'for Thursday' },
		note: 'a diet word after the product dropped'
	},
	{
		id: 'diet-finnish',
		origin: 'paraphrase (origin)',
		words: '10 kg Finnish potatoes for Friday',
		kind: 'reading',
		seeded: { items: [item('potatoes', 10, 'kg')], dateText: 'for Friday' },
		note: 'an origin word dropped'
	},
	{
		id: 'second-item-dropped',
		origin: 'CHAT-two-items',
		words: 'tarvitaan 10 kg perunoita ja 5 l maitoa perjantaiksi',
		kind: 'reading',
		seeded: { items: [item('perunoita', 10, 'kg')], dateText: 'perjantaiksi' },
		note: 'the second item in one line lost'
	},
	{
		id: 'follow-up-item-dropped',
		origin: 'CHAT-add-item',
		words: 'and 2 l of whipping cream too',
		kind: 'reading',
		seeded: { items: [] },
		note: 'a follow-up item added nothing'
	},
	{
		id: 'vegetarian-word',
		origin: 'DIET (vegetable balls)',
		words: '20 kg vegetarian balls for Wednesday',
		kind: 'reading',
		seeded: { items: [item('balls', 20, 'kg')], dateText: 'for Wednesday' },
		note: 'vegetarian has no requirement yet: should be said'
	},
	{
		id: 'brand-dropped',
		origin: 'R10-15',
		words: '10 l Arla whole milk for Friday',
		kind: 'reading',
		seeded: { items: [item('milk', 10, 'l')], dateText: 'for Friday' },
		note: 'the named brand and variant dropped'
	},
	{
		id: 'pack-request-substitute',
		origin: 'R11-02',
		words: '4 packs lactose-free milk for Thursday',
		kind: 'downstream',
		seeded: {
			items: [item('lactose-free milk', 4, 'sales', ['lactose_free'])],
			dateText: 'for Thursday'
		},
		note: 'read right; the substitute later buys ordinary milk'
	},
	{
		id: 'request-substitute',
		origin: 'R7-01',
		words: '10 litres of lactose-free milk for December 10',
		kind: 'downstream',
		seeded: {
			items: [item('lactose-free milk', 10, 'l', ['lactose_free'])],
			dateText: 'for December 10'
		},
		note: 'read right; the substitute later buys ordinary milk'
	},
	{
		id: 'resize-dimension',
		origin: 'R9-03',
		words: 'make it 20 kg',
		kind: 'downstream',
		seeded: { items: [item('it', 20, 'kg')] },
		note: 'read right; 20 kg on a litre line is a resize defect'
	},
	{
		id: 'same-words-two-tasks',
		origin: 'R8 task identity',
		words: 'Order 4 l lactose-free milk for Thursday',
		kind: 'downstream',
		seeded: {
			items: [item('lactose-free milk', 4, 'l', ['lactose_free'])],
			dateText: 'for Thursday'
		},
		note: 'read right; two tasks share one purchase'
	}
];

/** Reading defects the judge doesn't flag today: open under B, red once caught. */
const OPEN: Record<string, string> = {};

const rows: Record<string, unknown>[] = [];
afterAll(() => {
	if (!rows.length) return;
	mkdirSync('scratch', { recursive: true });
	writeFileSync('scratch/judge-recall.json', JSON.stringify(rows, null, '\t'));
	const reading = rows.filter((r) => r.kind === 'reading');
	const caught = reading.filter((r) => r.seeded !== 'pass').length;
	console.log(
		`judge recall: ${caught}/${reading.length} reading defects flagged; ${rows.length - reading.length} downstream cases are outside a reading check`
	);
	for (const r of rows)
		console.log(
			`  ${String(r.id).padEnd(26)} ${String(r.kind).padEnd(10)} seeded=${r.seeded} live=${r.live}`
		);
});

describe.skipIf(!has)('suite: request judge recall (request.reading, deterministic)', () => {
	for (const c of CASES) {
		const run = OPEN[c.id] && !process.env.ADV_SHOW ? it.fails : it;
		run(
			`${c.id} (${c.origin}) ${OPEN[c.id] ? `[open · ${OPEN[c.id]}] ` : ''}${c.note}`,
			async () => {
				const { reading, parse } = await load();
				const seeded = await reading.reviewReading(c.words, c.seeded);
				let live: string;
				try {
					const parsed = await parse.parseRequest(c.words, { today: '2026-12-07', llm: null });
					live = (await reading.reviewReading(c.words, reading.readingOf(parsed))).kind;
				} catch (e) {
					live = `error: ${(e as Error).message.slice(0, 60)}`;
				}
				rows.push({
					id: c.id,
					origin: c.origin,
					kind: c.kind,
					seeded: seeded.kind,
					live,
					note: c.note
				});
				if (c.kind === 'reading') expect(seeded.kind, JSON.stringify(seeded)).not.toBe('pass');
				else expect(seeded.kind, JSON.stringify(seeded)).toBe('pass');
			}
		);
	}
});
