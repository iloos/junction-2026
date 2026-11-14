import { describe, expect, it } from 'vitest';
import { presenterOpen, presenterToken, PRESENTER_TTL_MS, validPresenterToken } from './presenter';

const env = {
	MANDATE_KEY_CHEF: 'chef-key-0123456789abcdef',
	MANDATE_KEY_APPROVER: 'approver-key-0123456789ab',
	MANDATE_KEY_EXTERNAL_AGENT: 'agent-key-0123456789abcdef'
};

describe('presenter session', () => {
	it('opens only for the chef or approver key, and expires', () => {
		const t = Date.now();
		const tok = presenterToken(env.MANDATE_KEY_CHEF, env, t)!;
		expect(validPresenterToken(tok, env, t + 1000)).toBe(true);
		expect(validPresenterToken(tok, env, t + PRESENTER_TTL_MS + 1)).toBe(false);
		expect(presenterToken(env.MANDATE_KEY_APPROVER, env, t)).toMatch(/^approver\./);
		expect(presenterToken(env.MANDATE_KEY_EXTERNAL_AGENT, env, t)).toBeNull();
		expect(presenterToken('', env, t)).toBeNull();
	});
	it('ends when the key rotates or the token is edited', () => {
		const tok = presenterToken(env.MANDATE_KEY_CHEF, env)!;
		expect(validPresenterToken(tok, { ...env, MANDATE_KEY_CHEF: 'rotated-key-0123456789' })).toBe(
			false
		);
		const [role, exp, mac] = tok.split('.');
		expect(validPresenterToken(`${role}.${Number(exp) + 1}.${mac}`, env)).toBe(false);
		expect(validPresenterToken(`approver.${exp}.${mac}`, env)).toBe(false);
	});
	it('is open for everyone only in dev or with DEMO_RESET_OPEN=1', () => {
		expect(presenterOpen({}, false)).toBe(false);
		expect(presenterOpen({ DEMO_RESET_OPEN: 'yes' }, false)).toBe(false);
		expect(presenterOpen({ DEMO_RESET_OPEN: '1' }, false)).toBe(true);
		expect(presenterOpen({}, true)).toBe(true);
	});
});
