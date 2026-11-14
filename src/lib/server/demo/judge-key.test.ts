import { describe, expect, it } from 'vitest';
import { resolveKey } from '$lib/server/auth';
import { judgeKeyFor, verifyJudgeKey } from './judge-key';
import { newVisitorWorkspace } from './visitor-id';

const env = { JUDGE_KEY_SECRET: 'a-test-secret-of-enough-length' };

describe('judge keys', () => {
	it('verify for their own sandbox only and act as an external agent there', () => {
		const ws = newVisitorWorkspace();
		const key = judgeKeyFor(ws, env)!;
		expect(verifyJudgeKey(key, env)).toBe(ws);
		const ctx = resolveKey(key, env, { dev: false, via: 'mcp' })!;
		expect(ctx.workspaceId).toBe(ws);
		expect(ctx.actor.kind).toBe('external_agent');
		expect(ctx.scopes).not.toContain('approve');
		expect(ctx.actor.id).not.toContain(key.split('.')[1]);
	});
	it('refuse a key moved to another sandbox, a tampered MAC, and anything when the secret is unset', () => {
		const ws = newVisitorWorkspace();
		const other = newVisitorWorkspace();
		const mac = judgeKeyFor(ws, env)!.split('.')[1];
		expect(verifyJudgeKey(`${other}.${mac}`, env)).toBeNull();
		expect(verifyJudgeKey(`${ws}.${mac.slice(0, -1)}A`, env)).toBeNull();
		expect(verifyJudgeKey(`ws-judges.${mac}`, env)).toBeNull();
		expect(judgeKeyFor(ws, {})).toBeNull();
		expect(verifyJudgeKey(judgeKeyFor(ws, env), {})).toBeNull();
		expect(judgeKeyFor(ws, { JUDGE_KEY_SECRET: 'short' })).toBeNull();
	});
});
