/**
 * Menu lines the hero menu missed (15 Nov): "tuore timjami", "myskikurpitsa", "metsäsieniä" and "persikanpuolikkaat
 * sokeriliemessä" are in the catalogue under other words. resolve() retries a line that found nothing with those.
 */
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { loadCatalogue } from './valio';
import { RetrievalIndex, rewordings, toRetrievalProduct } from './retrieval';

describe('rewordings', () => {
	it('drops the packing liquid, then tries the aliases; "tuore" stays', () => {
		expect(rewordings('tuore timjami')).toEqual([]);
		expect(rewordings('persikanpuolikkaat sokeriliemessä')[0]).toBe('persikanpuolikkaat');
		expect(rewordings('herkkusienet')).toContain('herkkusieni');
		expect(rewordings('ruisjauhot')).toContain('ruisjauho');
		expect(rewordings('parmesaani')).toContain('parmesan');
		expect(rewordings('myskikurpitsa')).toEqual(['myskikurpitsakuutio', 'butternut']);
		expect(rewordings('metsäsieniä')).toEqual(['kantarelli', 'suppilovahvero']);
		expect(rewordings('kevytmaito')).toEqual([]);
	});
});

const DATA = 'data/valio/valio_aimo_junction26_product_data.json';
describe.skipIf(!existsSync(DATA))('menu lines resolve through a rewording', () => {
	const cat = existsSync(DATA) ? loadCatalogue('data/valio') : new Map();
	const ix = new RetrievalIndex([...cat.values()].map(toRetrievalProduct));
	const top = (q: string) => {
		const r = ix.resolve(q);
		return r.status === 'resolved' ? (cat.get(r.candidates[0].productId)?.nameFi ?? '') : '';
	};

	it.each([
		['myskikurpitsa', /myskikurpitsakuutio|butternut/i],
		['metsäsieniä', /kantarelli|suppilovahvero/i],
		['persikanpuolikkaat sokeriliemessä', /persikanpuolikkaat/i]
	])('%s', (q, want) => {
		expect(top(q)).toMatch(want);
		expect(top(q)).not.toMatch(/keitto|fondi|pyree|kakku/i);
	});

	it('"tuore timjami" never resolves to dried thyme', () => {
		expect(top('tuore timjami')).not.toMatch(/santa maria/i);
	});

	it('a line that resolves as written is unchanged', () => {
		expect(top('porkkana')).toMatch(/porkkana/i);
	});
});
