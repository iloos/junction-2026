/**
 * A substitute shares the food itself, not just its form: the fried egg's alternatives are eggs (raw, liquid or
 * fried, the form named), never fried onion cubes or onion rings that share "paistettu"/"fried".
 */
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { createDbPorts } from './db-ports';

const DAVA = '472106'; // DAVA premium paistettu muna, frozen
const ONIONS = ['464672', '467249']; // Ardo paistettu sipulikuutio, onion rings

describe.skipIf(!existsSync('data/valio/valio_aimo_junction26_product_data.json'))(
	'head-food gate',
	() => {
		it("a fried egg's substitutes are eggs, not fried onions", async () => {
			const env = await createDbPorts();
			const ids = (await env.ports.catalog.candidates(DAVA, 12)).map((c) => c.productId);
			for (const id of ONIONS) expect(ids).not.toContain(id);
			const names = [...(await env.ports.catalog.get(ids)).values()].map((p) =>
				`${p.nameFi} ${p.nameEn ?? ''}`.toLowerCase()
			);
			expect(names.length).toBeGreaterThan(0);
			for (const n of names) expect(n).toMatch(/muna|egg/);
		});
	}
);
