/**
 * S5 P0 "10 l vegan milk → raspberry sorbet": a near miss never crosses the product kind. "vegan milk" may only be a
 * plant drink, labelled, and asked as one question before anything is ordered; a sorbet is never a match.
 */
import { describe, expect, it } from 'vitest';
import { SCOPES_BY_ACTOR, type Product } from '$lib/core/contracts';
import type { CallContext } from '$lib/core/ports';
import { createHandlers } from '$lib/core/services/handlers';
import { createDbPorts } from '../store/db-ports';
import { filterHits } from './lookup';
import { parseRules } from './parse';
import { runRequest } from './run';

const TODAY = '2026-12-07';

describe('near miss: the kind gate', () => {
	it('"10 l vegan milk" keeps milk as its kind and searches plant drinks', () => {
		const [i] = parseRules('10 l vegan milk', TODAY).items;
		expect(i).toMatchObject({ product: null, kind: 'milk', qty: 10, unit: 'l' });
		expect(i.search).toContain('kaurajuoma');
	});

	it('a sorbet is rejected, a plant drink stands in with its label', async () => {
		const env = await createDbPorts({ now: '2026-12-07T09:00:00+02:00' });
		const get = async (id: string) => (await env.ports.catalog.get([id])).get(id) as Product;
		const sorbet = await get('461396');
		const oat = await get('460825');
		const [item] = parseRules('10 l vegan milk', TODAY).items;
		const { ranked, rejected } = filterHits({ ...item, id: 'x' }, [sorbet, oat]);
		expect(rejected.map((r) => r.productId)).toContain('461396');
		expect(ranked.map((r) => r.product.productId)).toEqual(['460825']);
		expect(ranked[0].nearMiss).toMatch(/plant drink: no vegan milk/);
		expect(ranked[0].reasons[0]).toMatch(/plant drink/);
	});
});

describe('near miss: asked, never ordered unasked', () => {
	it(
		'"10 l vegan milk" asks "oat drink instead?" with plant drinks as chips; the chip orders it',
		{
			timeout: 60_000
		},
		async () => {
			const env = await createDbPorts({ now: '2026-12-07T09:00:00+02:00' });
			const ctx: CallContext = {
				workspaceId: env.workspaceId,
				runId: env.runId,
				actor: { kind: 'kitchen_agent', id: 'a' },
				scopes: SCOPES_BY_ACTOR.kitchen_agent,
				via: 'test'
			};
			const kitchen = (await env.store.kitchens(env.workspaceId)).find((k) => k.id === 'k-hotel')!;
			const deps = {
				handlers: createHandlers(env.ports),
				ctx,
				today: TODAY,
				kitchen,
				clock: env.ports.clock
			};
			const r = await runRequest('10 l vegan milk for Friday', deps);
			const it = r.lookup?.items[0];
			if (!it) throw new Error('no lookup item');
			expect(it?.pick ?? null).toBeNull();
			const names = JSON.stringify(r.lookup);
			expect(names).not.toMatch(/sorbetti|GelatoLAB/i);
			expect(it?.question).toBeTruthy();
			{
				expect(it.question).toMatch(
					/^No vegan milk in the catalogue: .+ \(a plant drink\) instead\?$/
				);
				const chip = it.answer?.kind === 'choice' ? it.answer.options[0] : null;
				expect(chip).toBeTruthy();
				const again = await runRequest('10 l vegan milk for Friday', {
					...deps,
					answers: [chip!.answer]
				});
				const pick = again.lookup?.items[0].pick;
				expect(pick?.reasons.join(' ')).toMatch(/plant drink/);
			}
		}
	);
});
