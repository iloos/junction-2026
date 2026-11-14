import { describe, expect, it } from 'vitest';
import { SCOPES_BY_ACTOR } from '$lib/core/contracts';
import type { CallContext } from '$lib/core/ports';
import { createHandlers } from '$lib/core/services/handlers';
import { createDbPorts } from '../store/db-ports';
import { readRankBy } from './rank-by';
import { runRequest } from './run';

async function setup() {
	const env = await createDbPorts({ now: '2026-12-07T09:00:00+02:00' });
	env.overlay.clear();
	const ctx: CallContext = {
		workspaceId: env.workspaceId,
		runId: env.runId,
		actor: { kind: 'kitchen_agent', id: 'a' },
		scopes: SCOPES_BY_ACTOR.kitchen_agent,
		via: 'test'
	};
	const kitchen = (await env.store.kitchens(env.workspaceId)).find((k) => k.id === 'k-hotel')!;
	return {
		env,
		base: {
			handlers: createHandlers(env.ports),
			ctx,
			today: '2026-12-07',
			kitchen,
			clock: env.ports.clock
		}
	};
}

describe('Rank by: a per-request preference on the lookup', () => {
	it('the kitchen default adds no note; price picks the cheaper eggs and says what changed', async () => {
		const { base } = await setup();
		const def = await runRequest('50 eggs for Thursday', { ...base, place: false });
		expect(def.lookup!.items[0].rankNote).toBeUndefined();
		const cheap = await runRequest('50 eggs for Thursday', {
			...base,
			place: false,
			rankBy: 'price'
		});
		const it0 = cheap.lookup!.items[0];
		expect(it0.pick!.productId).not.toBe(def.lookup!.items[0].pick!.productId);
		expect(it0.rankNote).toMatch(/^Ranked by price: picked .+ over .+: −€[\d.,]+\/kg\.$/);
	});

	it('changes the pick, never the mandate: the placed line is tiered as always and the kitchen is untouched', async () => {
		const { env, base } = await setup();
		const before = JSON.stringify(base.kitchen.weights);
		const r = await runRequest('50 eggs for Thursday', { ...base, nonce: 'rb', rankBy: 'price' });
		expect(r.order?.plan.lines[0].tier).toBeDefined();
		const after = (await env.store.kitchens(env.workspaceId)).find((k) => k.id === 'k-hotel')!;
		expect(JSON.stringify(after.weights)).toBe(before);
	});

	it('reads only known presets from a request body', () => {
		expect(readRankBy('carbon')).toBe('carbon');
		expect(readRankBy('anything')).toBe('kitchen');
		expect(readRankBy(undefined)).toBe('kitchen');
	});
});
