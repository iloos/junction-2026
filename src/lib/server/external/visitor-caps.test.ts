import { describe, expect, it } from 'vitest';
import type { CallContext } from '$lib/core/ports';
import { webSpendKey } from '../web';
import { createSpendLedger } from './ledger';
import { scopeFor, spendKeyFor } from './scope';

const ctx = (over: Partial<CallContext>): CallContext =>
	({
		workspaceId: 'ws-judges',
		runId: 'run-1',
		actor: { kind: 'chef', id: 'kitchen-ui' },
		scopes: [],
		via: 'kitchen',
		...over
	}) as CallContext;

describe('spend keys per visitor', () => {
	it('keys model and Decide spend per visitor in the shared room, per workspace elsewhere', () => {
		expect(spendKeyFor(ctx({ sharedRoom: true, visitor: 'v1' }))).toBe('ws-judges:v1');
		expect(spendKeyFor(ctx({ sharedRoom: true, visitor: 'v2' }))).toBe('ws-judges:v2');
		// A visitor's own sandbox is already theirs alone; no room, no visitor: the workspace.
		expect(spendKeyFor(ctx({ workspaceId: 'ws-j-abc', visitor: 'v1' }))).toBe('ws-j-abc');
		expect(spendKeyFor(ctx({ sharedRoom: true }))).toBe('ws-judges');
		expect(scopeFor(ctx({ sharedRoom: true, visitor: 'v1' })).spendKey).toBe('ws-judges:v1');
	});

	it('keys web lookups per visitor, never by the kitchen UI actor every browser shares', () => {
		expect(webSpendKey(ctx({ visitor: 'v1' }))).toBe('visitor:ws-judges:v1');
		expect(webSpendKey(ctx({ visitor: 'v2' }))).not.toBe(webSpendKey(ctx({ visitor: 'v1' })));
		// An outside agent's key (no visitor) keeps its own caller key.
		expect(webSpendKey(ctx({ actor: { kind: 'external_agent', id: 'judge-7' } }))).toBe(
			'external_agent:judge-7'
		);
	});

	it('one visitor using up its cap leaves the other served; the global cap still bounds the total', () => {
		const ledger = createSpendLedger();
		const limits = { perKey: 3, global: 5 };
		const a = ledger.guard(spendKeyFor(ctx({ sharedRoom: true, visitor: 'a' })), limits);
		const b = ledger.guard(spendKeyFor(ctx({ sharedRoom: true, visitor: 'b' })), limits);
		const reason = (fn: () => unknown) => {
			try {
				fn();
				return null;
			} catch (e) {
				return (e as { reason?: string }).reason;
			}
		};
		for (let i = 0; i < 3; i++) a.charge('gemini');
		expect(reason(() => a.charge('gemini'))).toBe('cap-key');
		b.charge('gemini');
		b.charge('gemini');
		// 5 calls in all: the global stops the next one for everybody.
		expect(reason(() => b.charge('gemini'))).toBe('cap-global');
	});
});
