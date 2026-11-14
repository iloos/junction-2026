import { describe, expect, it } from 'vitest';
import { candidateFacts } from './live-view';

const f = (o: object) => ({ name: 'x', salesUnit: 'KG', ...o });

describe('candidate facts say something or nothing', () => {
	it('drops the default reliability and words the rest', () => {
		expect(candidateFacts(f({ reliability: 1 }), undefined).words).toEqual([]);
		expect(candidateFacts(f({ reliability: 0.97 }), undefined).words).toEqual([
			'reliable deliveries'
		]);
		expect(candidateFacts(f({ reliability: 0.8 }), undefined).words).toEqual(['late about 1 in 5']);
	});
	it('says carbon only against the original, and only when it differs', () => {
		const orig = f({ co2PerKg: 10 });
		expect(candidateFacts(f({ co2PerKg: 6 }), orig).words).toEqual([
			'lower CO₂e than the original'
		]);
		expect(candidateFacts(f({ co2PerKg: 12 }), orig).words).toEqual([
			'higher CO₂e than the original'
		]);
		expect(candidateFacts(f({ co2PerKg: 10.1 }), orig).words).toEqual([]);
		expect(candidateFacts(f({ co2PerKg: 10.1 }), undefined).words).toEqual([]);
		// Averages compare product groups and say so.
		expect(candidateFacts(f({ co2PerKg: 6, co2Estimated: true }), orig).words).toEqual([
			'lower CO₂e than the original (group average)'
		]);
	});
	it('names the labels a product has', () => {
		expect(
			candidateFacts(f({ origin: 'FI', labels: ['EU_ORGANIC_FARMING', 'MSC'] }), undefined).labels
		).toEqual(['Finnish', 'Organic', 'MSC']);
	});
});
