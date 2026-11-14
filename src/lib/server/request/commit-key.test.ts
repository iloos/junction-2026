import { describe, expect, it } from 'vitest';
import { commitKey, committableLines } from './index';

/**
 * R11-03: a commit from Request is named by its exact lines and terms. A partial commit and a later grant leave the
 * plan version alone, so a key from the version alone replayed the first receipt for the newly approved remainder.
 */
describe('one command identity for a Request commit', () => {
	const plan = {
		lines: [
			{ id: 'a', state: 'eligible' },
			{ id: 'b', state: 'held' },
			{ id: 'c', state: 'unorderable' }
		]
	};

	it('names the eligible line now; after it is ordered the set is the same (a retry), a grant adds the remainder', () => {
		expect(committableLines(plan, null)).toEqual(['a']);
		expect(committableLines(plan, { state: 'pending', lineIds: ['b'] })).toEqual(['a']);
		const after = { lines: [{ id: 'a', state: 'committed' }, ...plan.lines.slice(1)] };
		// A retry after the first commit succeeded: the same lines, so the same key.
		expect(committableLines(after, { state: 'pending', lineIds: ['b'] })).toEqual(['a']);
		// The remainder approved later: a new set, so a new command.
		expect(committableLines(after, { state: 'granted', lineIds: ['b'] })).toEqual(['a', 'b']);
	});

	it('same plan, version, terms and lines: same key; a remainder or new terms: a new key', async () => {
		const first = await commitKey('pl-1', 3, 'h1', ['a']);
		expect(await commitKey('pl-1', 3, 'h1', ['a'])).toBe(first);
		expect(await commitKey('pl-1', 3, 'h1', ['b'])).not.toBe(first);
		expect(await commitKey('pl-1', 3, 'h2', ['a'])).not.toBe(first);
		expect(await commitKey('pl-1', 3, 'h1', ['b', 'a'])).toBe(
			await commitKey('pl-1', 3, 'h1', ['a', 'b'])
		);
	});
});
