/**
 * Retrieval eval: recall@12 of substitute candidates on the labelled set in evals/retrieval/substitutes.json,
 * today's id order vs hybrid. Needs the Valio catalogue in data/valio/ (gitignored); skipped without it.
 * Print the table with `pnpm vitest run --project server retrieval.eval`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createValioCatalog } from './valio';
import type { RetrievalMode } from './retrieval';

interface Label {
	productId: string;
	name: string;
	acceptable: { productId: string; grade: 'same' | 'close' | 'functional' }[];
	nearMisses: { productId: string }[];
}
const K = 12;
const hasData = existsSync(join('data', 'valio', 'valio_aimo_junction26_product_data.json'));
const set: { targets: Label[] } = JSON.parse(
	readFileSync(join('evals', 'retrieval', 'substitutes.json'), 'utf-8')
);

export async function score(mode: RetrievalMode) {
	const cat = createValioCatalog({ retrieval: mode });
	const rows: {
		id: string;
		name: string;
		recall: number;
		strictRecall: number;
		precision: number;
		nearMiss: number;
	}[] = [];
	for (const t of set.targets) {
		const got = (await cat.candidates(t.productId, K)).map((c) => c.productId).slice(0, K);
		const all = new Set(t.acceptable.map((a) => a.productId));
		const strict = new Set(
			t.acceptable.filter((a) => a.grade !== 'functional').map((a) => a.productId)
		);
		const near = new Set(t.nearMisses.map((n) => n.productId));
		const hits = got.filter((id) => all.has(id)).length;
		const strictHits = got.filter((id) => strict.has(id)).length;
		rows.push({
			id: t.productId,
			name: t.name.slice(0, 32),
			recall: all.size ? hits / Math.min(all.size, K) : 1,
			strictRecall: strict.size ? strictHits / Math.min(strict.size, K) : 1,
			precision: got.length ? hits / got.length : 0,
			nearMiss: got.filter((id) => near.has(id)).length
		});
	}
	const mean = (f: (r: (typeof rows)[number]) => number) =>
		rows.reduce((a, r) => a + f(r), 0) / rows.length;
	return {
		rows,
		recall: mean((r) => r.recall),
		strictRecall: mean((r) => r.strictRecall),
		precision: mean((r) => r.precision),
		nearMiss: rows.reduce((a, r) => a + r.nearMiss, 0)
	};
}

describe.skipIf(!hasData)('retrieval eval (labelled substitutes, recall@12)', () => {
	it('hybrid beats id order on the labelled set', async () => {
		const [id, hy] = [await score('id'), await score('hybrid')];
		const pct = (x: number) => `${Math.round(x * 100)}%`.padStart(4);
		console.log(
			[
				`target                                   id: rec strict prec near | hybrid: rec strict prec near`,
				...id.rows.map((r, i) => {
					const h = hy.rows[i];
					return `${r.id} ${r.name.padEnd(32)} ${pct(r.recall)} ${pct(r.strictRecall)} ${pct(r.precision)} ${String(r.nearMiss).padStart(2)}  | ${pct(h.recall)} ${pct(h.strictRecall)} ${pct(h.precision)} ${String(h.nearMiss).padStart(2)}`;
				}),
				`MEAN ${' '.repeat(34)} ${pct(id.recall)} ${pct(id.strictRecall)} ${pct(id.precision)} ${String(id.nearMiss).padStart(2)}  | ${pct(hy.recall)} ${pct(hy.strictRecall)} ${pct(hy.precision)} ${String(hy.nearMiss).padStart(2)}`
			].join('\n')
		);
		expect(hy.recall).toBeGreaterThan(id.recall);
	});
});
