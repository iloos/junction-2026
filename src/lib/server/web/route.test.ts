import { describe, expect, it } from 'vitest';
import { authed, mayIngest } from './route';

const req = (key: string) =>
	new Request('http://x/api/web/recall', {
		method: 'POST',
		headers: { authorization: `Bearer ${key}` }
	});

describe('web route gate (M4)', () => {
	it('reads need the read scope; recording a notice needs a chef or system key with the plan scope', async () => {
		const chef = authed(req('fx-chef'), {}, true, 'web:recall');
		const agent = authed(req('fx-external-agent'), {}, true, 'web:recall');
		const approver = authed(req('fx-approver'), {}, true, 'web:recall');
		for (const c of [chef, agent, approver]) expect(c).not.toBeInstanceOf(Response);
		expect(mayIngest(chef as never)).toBeNull();
		expect(mayIngest(agent as never)?.status).toBe(403);
		expect(mayIngest(approver as never)?.status).toBe(403);
	});

	it('the replay drill refuses an approver (no plan scope) and a missing key', async () => {
		const r = authed(req('fx-approver'), {}, true, 'web:replay', ['chef', 'system'], 'plan');
		expect((r as Response).status).toBe(403);
		const none = authed(new Request('http://x'), {}, true, 'web:replay');
		expect((none as Response).status).toBe(401);
		const scope = authed(req('fx-approver'), {}, true, 'web:recall', undefined, 'plan');
		expect(await (scope as Response).json()).toMatchObject({
			error: { code: 'FORBIDDEN', message: 'web:recall needs the plan scope' }
		});
	});
});
