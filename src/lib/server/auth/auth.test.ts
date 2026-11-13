import { describe, expect, it } from 'vitest';
import { bearerFrom, keyTable, resolveKey, resolveRequest } from './index';

const prodEnv = {
	MANDATE_KEY_EXTERNAL_AGENT: 'ext-key-0123456789abcdef',
	MANDATE_KEY_CHEF: 'short',
	MCP_KEYS: 'judge-1:external_agent:judge-key-0123456789ab,bad:system:system-key-0123456789ab'
};

describe('auth: bearer key → CallContext', () => {
	it('derives actor, scopes, workspace and run from the key only', () => {
		const ctx = resolveKey('ext-key-0123456789abcdef', prodEnv, { dev: false, via: 'rest' });
		expect(ctx).toMatchObject({
			workspaceId: 'ws-demo',
			runId: 'run-1',
			actor: { kind: 'external_agent', id: 'external-agent' },
			via: 'rest'
		});
		expect(ctx?.scopes).not.toContain('approve');
		expect(ctx?.scopes).not.toContain('mandate:write');
	});

	it('accepts per-judge keys from MCP_KEYS and refuses internal actors there', () => {
		expect(
			resolveKey('judge-key-0123456789ab', prodEnv, { dev: false, via: 'mcp' })?.actor
		).toEqual({ kind: 'external_agent', id: 'judge-1' });
		expect(resolveKey('system-key-0123456789ab', prodEnv, { dev: false, via: 'mcp' })).toBeNull();
	});

	it('refuses short env keys, unknown keys and empty keys', () => {
		expect(resolveKey('short', prodEnv, { dev: false, via: 'rest' })).toBeNull();
		expect(resolveKey('nope-nope-nope-nope', prodEnv, { dev: false, via: 'rest' })).toBeNull();
		expect(resolveKey(undefined, prodEnv, { dev: false, via: 'rest' })).toBeNull();
	});

	it('enables the public fixture keys only in dev or when asked', () => {
		expect(resolveKey('fx-chef', prodEnv, { dev: false, via: 'rest' })).toBeNull();
		expect(resolveKey('fx-chef', prodEnv, { dev: true, via: 'rest' })?.scopes).toContain('approve');
		expect(keyTable({ MANDATE_FIXTURE_KEYS: '1' }, { dev: false })).toHaveLength(4);
	});

	it('reads the header before the path key', () => {
		const req = new Request('http://x/mcp', {
			headers: { authorization: 'Bearer fx-external-agent' }
		});
		expect(bearerFrom(req)).toBe('fx-external-agent');
		const ctx = resolveRequest(req, {}, { dev: true, via: 'mcp', pathKey: 'fx-chef' });
		expect(ctx?.actor.kind).toBe('external_agent');
		const noHeader = resolveRequest(
			new Request('http://x/mcp'),
			{},
			{
				dev: true,
				via: 'mcp',
				pathKey: 'fx-chef'
			}
		);
		expect(noHeader?.actor.kind).toBe('chef');
	});
});
