import { describe, expect, it } from 'vitest';
import { humanDates, readableName } from './format';

describe('humanDates', () => {
	it('reads ISO dates and times as a person would', () => {
		expect(humanDates('Valio cache had cut-off 2026-11-15T17:00:00+02:00')).toBe(
			'Valio cache had cut-off Sun 15 Nov, 17:00'
		);
		expect(humanDates('for delivery 2026-12-14')).toMatch(/for delivery Mon 14 Dec/);
		expect(humanDates('no dates here')).toBe('no dates here');
	});
});

describe('readableName', () => {
	it('puts ALL-CAPS catalogue names in sentence case, keeping label acronyms', () => {
		expect(readableName('AIMO 2,5/1,25KG SINAPPISILLI MSC')).toBe(
			'Aimo 2,5/1,25kg sinappisilli MSC'
		);
		expect(readableName('LOHIFILEE C-LEIKATTU 10KG')).toBe('Lohifilee c-leikattu 10kg');
		expect(readableName('HK Palvikinkku viipaloitu 1,5 kg')).toBe(
			'HK Palvikinkku viipaloitu 1,5 kg'
		);
		expect(readableName('AIMO X', 'Aimo mustard herring 2.5 kg · MSC')).toBe(
			'Aimo mustard herring 2.5 kg · MSC'
		);
	});
});
