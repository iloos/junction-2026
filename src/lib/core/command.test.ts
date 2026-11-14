import { describe, expect, it } from 'vitest';
import { commandKey } from './command';

describe('commandKey', () => {
	const base = { planId: 'p', version: 3, termsHash: 'h', lineIds: ['a', 'b'] };
	it('a retry of the same command is the same key, whatever the line order', async () => {
		expect(await commandKey(base)).toBe(await commandKey({ ...base, lineIds: ['b', 'a'] }));
	});
	it('another remainder or other terms is a new command', async () => {
		const k = await commandKey(base);
		expect(await commandKey({ ...base, lineIds: ['c'] })).not.toBe(k);
		expect(await commandKey({ ...base, termsHash: 'h2' })).not.toBe(k);
		expect(await commandKey({ ...base, version: 4 })).not.toBe(k);
	});
});
