/**
 * Finnish-only product names are hard for a reader without Finnish ("Elovena 1l kaurajuoma kahviin"). Valio's data
 * carries an English name for nearly every product; the kitchen shows it beside the Finnish one (Line.productNameEn,
 * snapshot englishNames).
 */
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { loadCatalogue } from './valio';

const DATA = 'data/valio/valio_aimo_junction26_product_data.json';
describe.skipIf(!existsSync(DATA))('English product names', () => {
	const cat = existsSync(DATA) ? loadCatalogue('data/valio') : new Map();
	const all = [...cat.values()];

	it('nearly every product has one', () => {
		expect(all.filter((p) => p.nameEn).length / all.length).toBeGreaterThan(0.99);
	});

	it.each([
		['kaurajuoma', /oat/i],
		['kahvimaito', /coffee|milk/i],
		['jauheliha', /mince|ground/i],
		['porkkana', /carrot/i],
		['jäätelö', /ice cream/i]
	])('a name with "%s" reads in English', (fi, en) => {
		const p = all.find((x) => x.nameFi.toLowerCase().includes(fi) && x.nameEn);
		expect(p?.nameEn).toMatch(en);
	});
});
