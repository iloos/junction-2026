import { describe, expect, it } from 'vitest';
import { SCOPES_BY_ACTOR } from '$lib/core/contracts';
import type { CallContext } from '$lib/core/ports';
import { createHandlers } from '$lib/core/services/handlers';
import { createDbPorts } from '../store/db-ports';
import { caseDescription } from './convert';
import { runRequest } from './run';
import { pageWorkspace, readAnswers } from './workspace';

const TODAY = '2026-11-14';

async function setup() {
	const env = await createDbPorts();
	env.overlay.clear();
	const quoted: string[][] = [];
	const offers = env.ports.catalog.offers.bind(env.ports.catalog);
	env.ports.catalog = {
		...env.ports.catalog,
		offers: async (ids, d) => (quoted.push(ids), offers(ids, d))
	};
	const h = createHandlers(env.ports);
	const ctx: CallContext = {
		workspaceId: env.workspaceId,
		runId: env.runId,
		actor: { kind: 'kitchen_agent', id: 'a' },
		scopes: SCOPES_BY_ACTOR.kitchen_agent,
		via: 'test'
	};
	const kitchen = (await env.store.kitchens(env.workspaceId)).find((k) => k.id === 'k-hotel')!;
	return { h, ctx, kitchen, quoted, products: env.ports.catalog };
}

describe('page workspace', () => {
	it('is the judges sandbox unless presenter actions are open', () => {
		expect(pageWorkspace({}, false)).toEqual({ id: 'ws-judges', stage: false });
		expect(pageWorkspace({ MANDATE_WORKSPACE: 'ws-demo' }, false).id).toBe('ws-judges');
		expect(pageWorkspace({}, true)).toEqual({ id: 'ws-demo', stage: true });
		expect(pageWorkspace({ DEMO_RESET_OPEN: '1' }, false)).toEqual({ id: 'ws-demo', stage: true });
		expect(pageWorkspace({ DEMO_RESET_OPEN: 'yes' }, false).id).toBe('ws-judges');
	});
	it('drops malformed answers', () => {
		expect(
			readAnswers([
				{ item: 0, qty: 40, unit: 'kg' },
				{ item: 1, productId: '464201' },
				{ item: -1, qty: 1, unit: 'l' },
				{ item: 2, qty: 5, unit: 'tonnes' },
				{ item: 3, productId: '1; drop' },
				'x'
			])
		).toEqual([
			{ item: 0, qty: 40, unit: 'kg' },
			{ item: 1, productId: '464201' }
		]);
		expect(readAnswers('nope')).toEqual([]);
	});
});

describe('case orders ask instead of picking', () => {
	it('describes what a case holds', async () => {
		const { products } = await setup();
		const m = await products.get(['463798', '464076', '464201']);
		expect(caseDescription(m.get('463798')!)).toBe('20 × 200 g = 4 kg');
		expect(caseDescription(m.get('464201')!)).toBe('10 × 1 l = 10 l');
	});

	it('"2 cases of butter" asks which case, then orders the chosen one', async () => {
		const { h, ctx, kitchen } = await setup();
		const r = await runRequest('2 cases of butter tomorrow', {
			handlers: h,
			ctx,
			today: TODAY,
			kitchen,
			nonce: 'b'
		});
		expect(r.order).toBeNull();
		const it0 = r.lookup!.items[0];
		expect(it0.pick).toBeNull();
		expect(it0.question).toMatch(/Which case\?/);
		expect(it0.answer?.kind).toBe('choice');
		const opts = it0.answer!.kind === 'choice' ? it0.answer!.options : [];
		expect(opts.length).toBeGreaterThanOrEqual(2);
		for (const o of opts) expect(o.label).toMatch(/×|per case/);

		const chosen = opts.find((o) => o.label.endsWith('= 10 kg')) ?? opts[0];
		const r2 = await runRequest('2 cases of butter tomorrow', {
			handlers: h,
			ctx,
			today: TODAY,
			kitchen,
			nonce: 'b',
			answers: [chosen.answer]
		});
		expect(r2.lookup!.items[0].pick?.productId).toBe(chosen.answer.productId);
		expect(r2.lookup!.items[0].pick?.reasons[0]).toBe('you chose this');
		expect(r2.order?.plan.lines[0].productId).toBe(chosen.answer.productId);
		expect(r2.parsed.answered).toEqual([chosen.answer]);
	}, 60_000);

	it('an inline amount answers "how much?" and quotes only then', async () => {
		const { h, ctx, kitchen, quoted } = await setup();
		const r = await runRequest('lactose-free milk by Monday', {
			handlers: h,
			ctx,
			today: TODAY,
			kitchen
		});
		expect(r.lookup!.items[0].answer).toMatchObject({ kind: 'qty', item: 0 });
		expect(quoted).toEqual([]);
		const r2 = await runRequest('lactose-free milk by Monday', {
			handlers: h,
			ctx,
			today: TODAY,
			kitchen,
			answers: [{ item: 0, qty: 1000, unit: 'l' }]
		});
		expect(r2.parsed.items[0].ambiguities).toEqual([]);
		expect(r2.lookup!.items[0].pick?.productId).toBe('464201');
		expect(r2.order?.plan.lines[0].qty.value).toBe(1000);
	}, 60_000);
});
