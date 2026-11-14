import { describe, expect, it } from 'vitest';
import { errorWords } from './error-words';

describe('errorWords', () => {
	it('says an ordered dish cannot change, without codes or tool names', () => {
		const w = errorWords({
			code: 'INVALID_INPUT',
			message: 'find_substitutes: STALE_VERSION the substitute for this dish is already committed'
		});
		expect(w).toBe("This dish is already ordered, so its product can't change now.");
	});
	it('words a stale version', () => {
		expect(errorWords({ code: 'STALE_VERSION', message: 'plan pl-123 is at v4' })).toMatch(
			/^The plan changed/
		);
	});
	it('strips codes, tool names and ids from anything else', () => {
		const w = errorWords({
			code: 'INVALID_INPUT',
			message: 'edit_line: OUT_OF_RANGE grams per guest for ln-abc must be at most 500'
		});
		expect(w).toBe('Grams per guest must be at most 500.');
		expect(w).not.toMatch(/[A-Z]{4,}|edit_line|ln-/);
	});
	it('never returns an empty sentence', () => {
		expect(errorWords({ code: 'INTERNAL', message: 'INTERNAL' })).toBe(
			'That did not work. Nothing was changed.'
		);
	});
});
