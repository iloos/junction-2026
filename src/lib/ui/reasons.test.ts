import { describe, expect, it } from 'vitest';
import { mandateStepWords } from './reasons';

describe('mandate step in words', () => {
	it('says the state, the tier and each reason in words, never the codes', () => {
		const w = mandateStepWords('held (propose): UNKNOWN_REQUIRED, new_sku');
		expect(w).toBe('Waits for you: needs your approval · Quantity not stated, New product');
		expect(w).not.toMatch(/UNKNOWN_REQUIRED|new_sku|propose\)/);
	});
	it('handles a line with no tier or reasons', () => {
		expect(mandateStepWords('committed')).toBe('Ordered');
		expect(mandateStepWords('quoted (act)')).toBe('Inside your rules: the agent may order it');
	});
	it('keeps text that is not a mandate step', () => {
		expect(mandateStepWords('availability: known (12)')).toBe('availability: known (12)');
	});
});
