/**
 * D26: a judge key minted for a visitor's sandbox acts as that visitor, so the visitor's own outside agent can order for
 * the kitchen they made and sees it first in get_context. A static key belongs to no visitor.
 */
import { describe, expect, it } from 'vitest';
import { createHandlers } from '$lib/core/services/handlers';
import { createGetContext } from '$lib/server/agent/get-context';
import { judgeKeyFor } from '$lib/server/demo/judge-key';
import { createDbPorts } from '$lib/server/store/db-ports';
import { resolveKey } from './index';
import { visitorKey } from './visitor-key';

const WS = 'ws-j-0123456789abcdef01234567';
const env = {
	JUDGE_KEY_SECRET: 'a-judge-key-secret-long-enough-for-tests',
	MANDATE_KEY_EXTERNAL_AGENT: 'static-external-key-0123456789',
	MANDATE_RUN: 'run-1'
};

describe('judge keys carry their visitor', () => {
	it('a key minted for a sandbox is that visitor; a static key is nobody', () => {
		const judge = resolveKey(judgeKeyFor(WS, env), env, { dev: false, via: 'mcp' });
		expect(judge?.workspaceId).toBe(WS);
		expect(judge?.visitor).toBe(visitorKey(WS));
		const statik = resolveKey(env.MANDATE_KEY_EXTERNAL_AGENT, env, { dev: false, via: 'mcp' });
		expect(statik).not.toBeNull();
		expect(statik?.visitor).toBeUndefined();
	});

	it("the visitor's agent orders for the kitchen they made and sees it first", async () => {
		const db = await createDbPorts({ workspaceId: WS, runId: 'run-1' });
		const h = createHandlers(db.ports);
		const agent = resolveKey(judgeKeyFor(WS, env), env, { dev: false, via: 'mcp' })!;
		// The visitor made it in the browser (chef, same visitor).
		const chef = {
			...agent,
			actor: { kind: 'chef' as const, id: 'chef-ui' },
			scopes: ['read', 'plan', 'order', 'approve']
		};
		const made = await h.create_kitchen(chef, { name: 'My café', profile: 'cafe' });
		if (!made.ok) throw new Error(made.error.message);
		const id = made.value.kitchen.kitchenId;

		const ctx = await createGetContext(db.ports)(agent, {});
		if (!ctx.ok) throw new Error(ctx.error.message);
		expect(ctx.value.kitchens[0]).toMatchObject({ id, mine: true });

		const order = await h.place_order(agent, {
			kitchenId: id,
			deliverBy: '2026-12-11',
			idempotencyKey: 'judge-1',
			lines: [{ productId: '464201', qty: 2, unit: 'ST' }]
		});
		expect(order.ok).toBe(true);
		// A key without that visitor is refused on it.
		const other = { ...agent, visitor: undefined };
		const refused = await h.place_order(other, {
			kitchenId: id,
			deliverBy: '2026-12-11',
			idempotencyKey: 'judge-2',
			lines: [{ productId: '464201', qty: 2, unit: 'ST' }]
		});
		expect(!refused.ok && refused.error.sub).toBe('store_owner');
	}, 120_000);
});
