/**
 * Resolve eval: menu ingredient queries (evals/retrieval/resolve.json) must pin a product that is the ingredient, not
 * a dish, mix or look-alike, or stay unresolved. Every case must pass. Needs data/valio/ (gitignored); skipped without.
 * Print the table with `pnpm vitest run --project server retrieval.resolve.eval --silent=false`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createValioCatalog } from './valio';

interface Case {
	q: string;
	diet?: string[];
	accept?: string;
	reject?: string;
	unresolved?: boolean;
	/** Unresolved also passes; a pinned product must still match. */
	allowUnresolved?: boolean;
}
const hasData = existsSync(join('data', 'valio', 'valio_aimo_junction26_product_data.json'));
const set: { cases: Case[] } = JSON.parse(
	readFileSync(join('evals', 'retrieval', 'resolve.json'), 'utf-8')
);

describe.skipIf(!hasData)('resolve eval (menu ingredients)', () => {
	it('pins the ingredient itself or stays unresolved', async () => {
		const cat = createValioCatalog({});
		const rows: { q: string; ok: boolean; got: string }[] = [];
		for (const c of set.cases) {
			const r = await cat.resolve!(c.q, { diet: c.diet, limit: 3 });
			if (c.unresolved) {
				rows.push({
					q: c.q,
					ok: r.status === 'unresolved',
					got: r.status === 'unresolved' ? r.reason : 'resolved'
				});
				continue;
			}
			if (r.status !== 'resolved') {
				rows.push({ q: c.q, ok: Boolean(c.allowUnresolved), got: `unresolved: ${r.reason}` });
				continue;
			}
			const name =
				(await cat.get([r.candidates[0].productId])).get(r.candidates[0].productId)?.nameFi ?? '';
			const ok =
				new RegExp(c.accept!, 'i').test(name) &&
				!(c.reject && new RegExp(c.reject, 'i').test(name));
			rows.push({ q: `${c.q}${c.diet ? ` [${c.diet}]` : ''}`, ok, got: name });
		}
		console.log(
			rows.map((r) => `${r.ok ? '✓' : '✗'} ${r.q.padEnd(28)} ${r.got.slice(0, 70)}`).join('\n')
		);
		expect(rows.filter((r) => !r.ok)).toEqual([]);
	}, 120_000);
});
