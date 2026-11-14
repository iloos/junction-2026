import { describe, expect, it } from 'vitest';
import { resolveKey } from '$lib/server/auth';
import { createJudgeKeys, judgeKeyFor, verifyJudgeKey } from './judge-key';
import { newVisitorWorkspace } from './visitor-id';

const env = { JUDGE_KEY_SECRET: 'a-test-secret-of-enough-length' };
const later = new Date(Date.now() + 3_600_000);

describe('judge keys', () => {
	it('have the D9 format, verify for their own sandbox and act as an external agent there', () => {
		const ws = newVisitorWorkspace();
		const key = createJudgeKeys(env).mint(ws, later)!;
		expect(key.startsWith(`jk_${ws}.`)).toBe(true);
		expect(key.slice(ws.length + 4)).toMatch(/^\d+\.[A-Za-z0-9_-]{43}$/);
		expect(verifyJudgeKey(key, env)).toBe(ws);
		const ctx = resolveKey(key, env, { dev: false, via: 'mcp' })!;
		expect(ctx.workspaceId).toBe(ws);
		expect(ctx.actor.kind).toBe('external_agent');
		expect(ctx.scopes).not.toContain('approve');
		expect(ctx.actor.id).not.toContain(key.split('.')[2]);
	});
	it('refuse a moved, tampered, extended or expired key, and anything when the secret is unset', () => {
		const keys = createJudgeKeys(env);
		const ws = newVisitorWorkspace();
		const other = newVisitorWorkspace();
		const key = keys.mint(ws, later)!;
		const [, exp, mac] = key.split('.');
		expect(keys.verify(`jk_${other}.${exp}.${mac}`, new Date())).toBeNull();
		// Swap one character for a different one, so the MAC text always changes.
		const flip = (c: string) => (c === 'A' ? 'B' : 'A');
		const tampered = mac.slice(0, 20) + flip(mac[20]) + mac.slice(21);
		expect(keys.verify(`jk_${ws}.${exp}.${tampered}`, new Date())).toBeNull();
		expect(keys.verify(`jk_${ws}.${Number(exp) + 3600}.${mac}`, new Date())).toBeNull();
		expect(keys.verify(key, new Date(later.getTime() + 1000))).toBeNull();
		expect(keys.verify(`jk_ws-judges.${exp}.${mac}`, new Date())).toBeNull();
		expect(createJudgeKeys({}).mint(ws, later)).toBeNull();
		expect(createJudgeKeys({}).verify(key, new Date())).toBeNull();
		expect(createJudgeKeys({ JUDGE_KEY_SECRET: 'short' }).mint(ws, later)).toBeNull();
		expect(judgeKeyFor(ws, { ...env, JUDGE_KEY_EXPIRES: '2020-01-01T00:00:00Z' })).not.toBeNull();
		expect(
			verifyJudgeKey(judgeKeyFor(ws, { ...env, JUDGE_KEY_EXPIRES: '2020-01-01T00:00:00Z' }), env)
		).toBeNull();
	});
});
