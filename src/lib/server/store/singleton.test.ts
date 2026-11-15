import { describe, expect, it } from 'vitest';
import { retryingOnce } from './singleton';

describe('a per-process singleton', () => {
	it('builds once while it succeeds', async () => {
		const slot: { current?: Promise<number> } = {};
		let n = 0;
		const make = async () => ++n;
		expect(await retryingOnce(slot, make)).toBe(1);
		expect(await retryingOnce(slot, make)).toBe(1);
		expect(n).toBe(1);
	});

	it('forgets a failed build, so the next caller builds again', async () => {
		const slot: { current?: Promise<string> } = {};
		let n = 0;
		const make = async () => {
			n += 1;
			if (n === 1) throw new Error('database not ready');
			return 'ports';
		};
		await expect(retryingOnce(slot, make)).rejects.toThrow('database not ready');
		await Promise.resolve();
		expect(await retryingOnce(slot, make)).toBe('ports');
		expect(n).toBe(2);
	});
});
