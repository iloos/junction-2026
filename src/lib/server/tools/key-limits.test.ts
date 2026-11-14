import { beforeEach, describe, expect, it } from 'vitest';
import type { CallContext } from '$lib/core/ports';
import { isMetered, resetKeyLimits, takeKeyCall } from './key-limits';

const ctx = (id: string, kind: CallContext['actor']['kind'] = 'external_agent'): CallContext => ({
	workspaceId: 'ws-j-test',
	runId: 'run-1',
	actor: { kind, id },
	scopes: ['read', 'plan', 'order'],
	via: 'mcp'
});
const limits = { calls: 5, writes: 2, quotes: 1 };

describe('key limits', () => {
	beforeEach(resetKeyLimits);

	it('meters outside agents only, and not under vitest', () => {
		expect(isMetered(ctx('a'), {})).toBe(true);
		expect(isMetered(ctx('a', 'kitchen_agent'), {})).toBe(false);
		expect(isMetered(ctx('a', 'chef'), {})).toBe(false);
		expect(isMetered(ctx('a'), { VITEST: 'true' })).toBe(false);
	});

	it('refuses the write over the window and says how long to wait', () => {
		const t = 1_000_000;
		expect(takeKeyCall(ctx('a'), 'place_order', t, limits)).toBeNull();
		expect(takeKeyCall(ctx('a'), 'plan_event', t + 1, limits)).toBeNull();
		expect(takeKeyCall(ctx('a'), 'edit_line', t + 2, limits)).toEqual({
			bucket: 'writes',
			retryAfter: 60
		});
		// Reads still go through; the refused write was not counted.
		expect(takeKeyCall(ctx('a'), 'get_plan', t + 3, limits)).toBeNull();
		// After the window the writes come back.
		expect(takeKeyCall(ctx('a'), 'edit_line', t + 60_001, limits)).toBeNull();
	});

	it('meters quotes on their own, and each key separately', () => {
		const t = 2_000_000;
		expect(takeKeyCall(ctx('a'), 'quote', t, limits)).toBeNull();
		expect(takeKeyCall(ctx('a'), 'quote', t + 10_000, limits)?.bucket).toBe('quotes');
		expect(takeKeyCall(ctx('b'), 'quote', t + 10_000, limits)).toBeNull();
	});

	it('caps every call', () => {
		const t = 3_000_000;
		for (let i = 0; i < 5; i++) expect(takeKeyCall(ctx('a'), 'get_plan', t + i, limits)).toBeNull();
		expect(takeKeyCall(ctx('a'), 'get_context', t + 5, limits)?.bucket).toBe('calls');
	});
});
