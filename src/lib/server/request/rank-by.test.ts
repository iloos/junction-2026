import { describe, expect, it } from 'vitest';
import { SCOPES_BY_ACTOR } from '$lib/core/contracts';
import type { CallContext } from '$lib/core/ports';
import { createHandlers } from '$lib/core/services/handlers';
import { createDbPorts } from '../store/db-ports';
import { preferenceNote, preferenceOrder, priceBasis, readRankBy } from './rank-by';
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
		expect(it0.rankNote).toMatch(/^Ranked by price: picked .+ over .+: −€[\d.,]+ in total\.$/);
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

describe('R11-09: price compares on a common basis, never unlike pack prices', () => {
	const kitchen = { weights: {} } as never;
	const prod = (id: string) =>
		({ productId: id, nameFi: id, labels: [], co2PerKg: null, origin: null }) as never;
	const offer = (id: string, unitCents: number, comparison?: { cents: number; unit: string }) =>
		[
			id,
			{
				productId: id,
				price: { unitCents, comparison: comparison ?? null },
				availability: {}
			}
		] as const;

	it('a 100 g pack at €2 does not beat a 1 kg pack at €10 for 1 kg: total to satisfy decides', () => {
		const offers = new Map([offer('small', 200), offer('big', 1000)] as never);
		// 1 kg asked: ten of the small packs, one of the big.
		const short = [
			{ product: prod('small'), qty: 10 },
			{ product: prod('big'), qty: 1 }
		];
		expect(priceBasis(short, offers as never)).toEqual({ kind: 'total' });
		expect(preferenceOrder('price', kitchen, short, offers as never)).toEqual([1, 0]);
	});

	it('mixed coverage without quantities: the shared comparison unit, else no basis and it says so', () => {
		const mixed = new Map([
			offer('a', 500, { cents: 1000, unit: 'kg' }),
			offer('b', 300),
			offer('c', 400, { cents: 800, unit: 'kg' })
		] as never);
		const short = ['a', 'b', 'c'].map((id) => ({ product: prod(id), qty: 0 }));
		expect(priceBasis(short, mixed as never)).toEqual({ kind: 'comparison', unit: 'kg' });
		expect(preferenceOrder('price', kitchen, short, mixed as never)?.[0]).toBe(2);
		const none = new Map([offer('a', 500), offer('b', 300)] as never);
		const two = short.slice(0, 2);
		expect(priceBasis(two, none as never)).toBeNull();
		expect(preferenceOrder('price', kitchen, two, none as never)).toBeNull();
		expect(preferenceNote('price', { product: prod('a') }, null, null)).toMatch(/no common basis/);
	});
});
