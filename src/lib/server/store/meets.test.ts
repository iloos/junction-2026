/** D16 on real catalogue records: one evaluator, ok / unknown / no with a reason. */
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Product } from '$lib/core/contracts';
import { meets, requirementsFromDiet } from '$lib/core/mandate/meets';
import { loadCatalogue } from '../adapters/catalog/valio';

const DIR = join('data', 'valio');
describe.skipIf(!existsSync(join(DIR, 'valio_aimo_junction26_product_data.json')))(
	'meets() on Valio records',
	() => {
		const cat = existsSync(join(DIR, 'valio_aimo_junction26_product_data.json'))
			? loadCatalogue(DIR)
			: new Map();
		const p = (id: string) => cat.get(id) as Product;
		const VEG = requirementsFromDiet(['VEG', 'L'])!;

		it('VEG: vegetable balls and raw potatoes pass, meatballs fail, a feta patty with no record is unknown', () => {
			expect(meets(p('463847'), VEG).verdict).toBe('ok'); // Kasvispyörykkä, vegetarian record
			expect(meets(p('475214'), VEG).verdict).toBe('ok'); // raw potatoes, no diet tag
			const meat = meets(p('461810'), VEG); // Jättilihapulla
			expect(meat.verdict).toBe('no');
			expect(meat.failing[0].why).toContain('meat');
			// Feta-vegetable patty, prepared, no tag: unknown for VEG alone (with L its feta's milk makes it a no).
			expect(meets(p('467290'), requirementsFromDiet(['VEG'])).verdict).toBe('unknown');
			expect(meets(p('467290'), VEG).verdict).toBe('no');
		});

		it('M excludes milk; L passes a lactose-free milk and a vegan salad, fails ordinary milk', () => {
			const M = requirementsFromDiet(['M'])!;
			expect(meets(p('464249'), M).verdict).toBe('no'); // cooking cream
			const L = requirementsFromDiet(['L'])!;
			expect(meets(p('464201'), L).verdict).toBe('ok');
			expect(meets(p('467149'), L).verdict).toBe('ok'); // iceberg: no allergen record, vegan diet record
			expect(meets(p('470418'), L).verdict).not.toBe('ok');
		});

		it('G with an undeclared allergen record is unknown, never ok', () => {
			const G = requirementsFromDiet(['G'])!;
			const undeclared = [...cat.values()].find(
				(x: Product) => x.isFood && !x.allergens.declared && !x.freeFrom.includes('GLUTEN')
			) as Product;
			expect(meets(undeclared, G).verdict).toBe('unknown');
		});

		it('counted scopes and VL add nothing', () => {
			expect(requirementsFromDiet(['vegetarian:6', 'VL'])).toBeUndefined();
		});
	}
);
