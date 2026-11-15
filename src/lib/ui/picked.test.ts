import { describe, expect, it } from 'vitest';
import { pickedWords } from './picked';

describe('why a replacement was picked', () => {
	it('says supply, origin and the strongest score part in a few words', () => {
		expect(
			pickedWords({
				kind: 'known',
				origin: 'fi',
				score: {
					total: 0.8,
					components: {
						price: { utility: 0.9, weight: 0.5 },
						reliability: { utility: 0.7, weight: 0.3 }
					}
				}
			})
		).toBe('in stock · Finnish · best €/kg');
	});
	it('says nothing when it has nothing to go on', () => {
		expect(pickedWords({ kind: 'unknown' })).toBeNull();
	});
});
