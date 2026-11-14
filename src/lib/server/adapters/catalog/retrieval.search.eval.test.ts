/**
 * Search eval: precision@5 of catalogue search on the ingredient queries in evals/retrieval/queries.json, and
 * whether nonsense stays unresolved. Needs data/valio/ (gitignored); skipped without it.
 * Print the table with `pnpm vitest run --project server retrieval.search.eval --silent=false`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createValioCatalog } from './valio';
import type { RetrievalMode } from './retrieval';

interface Query {
	q: string;
	accept?: string;
	reject?: string;
	expectEmpty?: boolean;
}
const hasData = existsSync(join('data', 'valio', 'valio_aimo_junction26_product_data.json'));
const set: { k: number; queries: Query[] } = JSON.parse(
	readFileSync(join('evals', 'retrieval', 'queries.json'), 'utf-8')
);

async function score(mode: RetrievalMode) {
	const cat = createValioCatalog({ search: mode });
	const rows: { q: string; p: number; top1: boolean; n: number; ok: boolean; first: string }[] = [];
	for (const t of set.queries) {
		const hits = await cat.search(t.q, { limit: set.k });
		if (t.expectEmpty) {
			rows.push({
				q: t.q,
				p: 0,
				top1: false,
				n: hits.length,
				ok: hits.length === 0,
				first: hits[0]?.nameFi ?? ''
			});
			continue;
		}
		const acc = new RegExp(t.accept!, 'i');
		const rej = t.reject ? new RegExp(t.reject, 'i') : null;
		const good = (name: string) => acc.test(name) && !(rej && rej.test(name));
		const g = hits.filter((h) => good(h.nameFi)).length;
		rows.push({
			q: t.q,
			p: hits.length ? g / hits.length : 0,
			top1: hits.length > 0 && good(hits[0].nameFi),
			n: hits.length,
			ok: hits.length > 0,
			first: hits[0]?.nameFi ?? ''
		});
	}
	const real = rows.filter((_, i) => !set.queries[i].expectEmpty);
	return {
		rows,
		precision: real.reduce((a, r) => a + r.p, 0) / real.length,
		top1: real.filter((r) => r.top1).length / real.length,
		emptyOk: rows.filter((r, i) => set.queries[i].expectEmpty && r.ok).length
	};
}

describe.skipIf(!hasData)('search eval (ingredient queries, precision@5)', () => {
	it('hybrid search beats substring search and leaves nonsense unresolved', async () => {
		const [id, hy] = [await score('id'), await score('hybrid')];
		const pct = (x: number) => `${Math.round(x * 100)}%`.padStart(4);
		console.log(
			[
				'query                   substring: p@5 top1 | hybrid: p@5 top1  hybrid first hit',
				...id.rows.map((r, i) => {
					const h = hy.rows[i];
					return `${r.q.padEnd(24)} ${pct(r.p)} ${r.top1 ? ' yes' : '  no'} | ${pct(h.p)} ${h.top1 ? ' yes' : '  no'}  ${h.n ? h.first.slice(0, 40) : '(unresolved)'}`;
				}),
				`MEAN ${' '.repeat(19)} ${pct(id.precision)} ${pct(id.top1)} | ${pct(hy.precision)} ${pct(hy.top1)}  nonsense unresolved: ${id.emptyOk} vs ${hy.emptyOk}`
			].join('\n')
		);
		expect(hy.precision).toBeGreaterThan(id.precision);
		expect(hy.emptyOk).toBe(set.queries.filter((q) => q.expectEmpty).length);
	});
});
