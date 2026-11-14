/**
 * D16 safety on 68 hand-labelled Valio products (0d, facets.fixture.json): meets() never says "ok" for vegetarian or
 * vegan where the label says no or can't tell. Coverage (how often it decides at all) is reported, not required.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Product } from '$lib/core/contracts';
import { meets } from '$lib/core/mandate/meets';
import { loadCatalogue } from '../adapters/catalog/valio';

interface Item {
	productId: string;
	name: string;
	vegetarianOk: boolean | null;
	veganOk: boolean | null;
}
const set: { items: Item[] } = JSON.parse(
	readFileSync(join('src', 'lib', 'server', 'evals', 'facets.fixture.json'), 'utf-8')
);
const DIR = join('data', 'valio');

describe.skipIf(!existsSync(join(DIR, 'valio_aimo_junction26_product_data.json')))(
	'suite: diet facets (D16)',
	() => {
		const cat = loadCatalogue(DIR);
		for (const diet of ['vegetarian', 'vegan'] as const)
			it(`no unsafe "ok" for ${diet}`, () => {
				const rows = set.items
					.filter((i) => cat.has(i.productId))
					.map((i) => {
						const label = diet === 'vegetarian' ? i.vegetarianOk : i.veganOk;
						const m = meets(cat.get(i.productId) as Product, { diet: [diet] });
						return {
							id: i.productId,
							name: i.name,
							label,
							verdict: m.verdict,
							why: m.failing[0]?.why
						};
					});
				const unsafe = rows.filter((r) => r.verdict === 'ok' && r.label !== true);
				const decided = rows.filter((r) => r.verdict !== 'unknown').length;
				const wrongNo = rows.filter((r) => r.verdict === 'no' && r.label === true);
				if (process.env.FACETS_REPORT)
					writeFileSync(
						`../facets-${diet}.json`,
						JSON.stringify({ decided, total: rows.length, unsafe, wrongNo, rows }, null, 1)
					);
				expect(unsafe, JSON.stringify(unsafe)).toEqual([]);
			});
	}
);
