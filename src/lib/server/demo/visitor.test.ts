import { describe, expect, it } from 'vitest';
import type { Cookies } from '@sveltejs/kit';
import { currentRun, currentRunStartedAt } from './run';
import { presenterToken, PRESENTER_COOKIE } from './presenter';
import { isVisitorWorkspace } from './visitor-id';
import { ROOM_COOKIE, VISITOR_COOKIE, visitorWorkspace } from './visitor';

/** A cookie jar standing in for one browser. */
function browser(): Cookies {
	const jar = new Map<string, string>();
	return {
		get: (n: string) => jar.get(n),
		getAll: () => [...jar].map(([name, value]) => ({ name, value })),
		set: (n: string, v: string) => void jar.set(n, v),
		delete: (n: string) => void jar.delete(n),
		serialize: () => ''
	} as unknown as Cookies;
}
const PROD = {};
const at = (q = '') => new URL(`http://x/ops${q}`);

describe('visitor workspace', () => {
	it('gives each browser its own sandbox with a fresh run, stable across requests', async () => {
		const a = browser();
		const b = browser();
		const t0 = Date.now();
		const va = await visitorWorkspace({ cookies: a }, PROD, false);
		const vb = await visitorWorkspace({ cookies: b }, PROD, false);
		expect(isVisitorWorkspace(va.workspaceId)).toBe(true);
		expect(va.kind).toBe('own');
		expect(vb.workspaceId).not.toBe(va.workspaceId);
		expect(a.get(VISITOR_COOKIE)).toBe(va.workspaceId);
		expect((await visitorWorkspace({ cookies: a }, PROD, false)).workspaceId).toBe(va.workspaceId);
		// The run starts now, so the scenario clock starts at the visit, not at process start.
		expect(currentRun(va.workspaceId)).toMatch(/^run-/);
		expect(currentRunStartedAt(va.workspaceId)).toBeGreaterThanOrEqual(t0);
	}, 30_000);

	it('moves rooms by link: shared room, another sandbox, back to mine; the stage only for presenters', async () => {
		const a = browser();
		const own = (await visitorWorkspace({ cookies: a }, PROD, false)).workspaceId;
		const other = (await visitorWorkspace({ cookies: browser() }, PROD, false)).workspaceId;
		const go = (q: string) =>
			visitorWorkspace({ cookies: a, url: at(q) }, PROD, false, { follow: true });

		expect(await go('?ws=ws-judges')).toMatchObject({ workspaceId: 'ws-judges', kind: 'shared' });
		// Sticky: an API call without the query stays in the room.
		expect((await visitorWorkspace({ cookies: a }, PROD, false)).workspaceId).toBe('ws-judges');
		expect(await go(`?ws=${other}`)).toMatchObject({ workspaceId: other, kind: 'link' });
		expect(await go('?ws=mine')).toMatchObject({ workspaceId: own, kind: 'own' });
		expect((await go('?ws=ws-demo')).workspaceId).toBe(own);
		expect((await go('?ws=ws-evil')).workspaceId).toBe(own);
		// Without `follow` (API calls), the query is ignored.
		expect(
			(await visitorWorkspace({ cookies: a, url: at('?ws=ws-judges') }, PROD, false)).workspaceId
		).toBe(own);
	}, 30_000);

	it('defaults a signed-in presenter to the stage; dev keeps the stage as before', async () => {
		const env = { MANDATE_KEY_CHEF: 'chef-key-0123456789abcdef' };
		const p = browser();
		p.set(PRESENTER_COOKIE, presenterToken(env.MANDATE_KEY_CHEF, env)!, {} as never);
		expect(await visitorWorkspace({ cookies: p }, env, false)).toMatchObject({
			workspaceId: 'ws-demo',
			kind: 'stage',
			presenter: true
		});
		expect((await visitorWorkspace({ cookies: browser() }, {}, true)).workspaceId).toBe('ws-demo');
		// A stale stage room falls back to the visitor's own sandbox once the session is gone.
		const q = browser();
		q.set(ROOM_COOKIE, 'ws-demo', {} as never);
		expect((await visitorWorkspace({ cookies: q }, PROD, false)).kind).toBe('own');
	}, 30_000);
});
