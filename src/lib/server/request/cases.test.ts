import { describe, expect, it } from 'vitest';
import { SCOPES_BY_ACTOR, type Product } from '$lib/core/contracts';
import { createHandlers } from '$lib/core/services/handlers';
import { createDbPorts } from '../store/db-ports';
import { caseBreakdown, caseHeadline, convert } from './convert';
import { runRequest } from './run';
import { dailyCovers, sanityWarnings } from './sanity';

const TODAY = '2026-11-14';

async function catalogue(ids: string[]) {
	const env = await createDbPorts();
	return { env, m: await env.ports.catalog.get(ids) };
}

describe('case math: headline and conversion come from one computation', () => {
	it('Eila voi 4x5 kg: one ST is a 5 kg block, a case is 4 of them', async () => {
		const { m } = await catalogue(['464076']);
		const p = m.get('464076')!;
		const b = caseBreakdown(p, 2);
		expect(b).toMatchObject({
			salesQty: 8,
			salesUnit: 'ST',
			perCase: { count: 4, each: '5 kg', total: '20 kg' },
			orderTotal: '40 kg'
		});
		expect(caseHeadline(b as Exclude<typeof b, { error: string }>)).toBe('2 × (4 × 5 kg) = 40 kg');
		const c = convert(2, 'case', p);
		expect(c.ok && c.explain).toBe('2 KI × 4 ST per KI = 8 ST (= 40 kg)');
		// 1 kg of butter for €37.33 / 5 = €7.47: the price agrees with a 5 kg ST.
		expect(convert(40, 'kg', p)).toMatchObject({ ok: true, salesQty: 8 });
	});

	it('Valio voi 500 g (ST, KI = 20): 2 cases = 40 ST = 20 kg', async () => {
		const { m } = await catalogue(['464411']);
		const p = m.get('464411')!;
		const b = caseBreakdown(p, 2) as Exclude<ReturnType<typeof caseBreakdown>, { error: string }>;
		expect(caseHeadline(b)).toBe('2 × (20 × 500 g) = 20 kg');
		const c = convert(2, 'case', p);
		expect(c.ok && c.explain).toBe('2 KI × 20 ST per KI = 40 ST (= 20 kg)');
	});

	it('Valio voi 200 g sold by the KI of 20: 2 cases = 2 KI = 8 kg', async () => {
		const { m } = await catalogue(['463798']);
		const p = m.get('463798')!;
		const b = caseBreakdown(p, 2) as Exclude<ReturnType<typeof caseBreakdown>, { error: string }>;
		expect(caseHeadline(b)).toBe('2 × (20 × 200 g) = 8 kg');
		const c = convert(2, 'case', p);
		expect(c.ok && c.explain).toBe('2 cases = 2 KI (= 8 kg)');
	});

	it('every case card on the butter question agrees with its own conversion', async () => {
		const { env } = await catalogue([]);
		const h = createHandlers(env.ports);
		const kitchen = (await env.store.kitchens(env.workspaceId)).find((k) => k.id === 'k-hotel')!;
		const r = await runRequest('2 cases of butter tomorrow', {
			handlers: h,
			ctx: {
				workspaceId: env.workspaceId,
				runId: env.runId,
				actor: { kind: 'kitchen_agent', id: 'a' },
				scopes: SCOPES_BY_ACTOR.kitchen_agent,
				via: 'test'
			},
			today: TODAY,
			kitchen
		});
		const it0 = r.lookup!.items[0];
		const opts = it0.answer?.kind === 'choice' ? it0.answer.options : [];
		expect(opts.length).toBeGreaterThan(1);
		for (const o of opts) {
			const v = it0.shortlist.find((c) => c.productId === o.answer.productId)!;
			const total = o.label.split(' = ').at(-1);
			expect(v.conversion?.ok && v.conversion.explain).toContain(`(= ${total})`);
		}
		expect(opts.map((o) => o.label)).not.toContain('4 × 20 kg = 80 kg');
	}, 60_000);
});

describe('size check before placing', () => {
	it('counts daily covers from the kitchen size', async () => {
		const { env } = await catalogue([]);
		const ks = await env.store.kitchens(env.workspaceId);
		expect(dailyCovers(ks.find((k) => k.id === 'k-hotel')!)).toBe(380);
	});

	it('warns on per-cover amount and on the weekly limit, from the kitchen numbers', async () => {
		const { env } = await catalogue([]);
		const k = (await env.store.kitchens(env.workspaceId)).find((x) => x.id === 'k-hotel')!;
		const pick = {
			productId: '000001',
			name: 'Appelsiinitäysmehu 5 l',
			score: 1,
			reasons: [],
			salesUnit: 'KI',
			conversion: { ok: true as const, salesQty: 200000, explain: '', exact: true, warnings: [] },
			offer: { productId: '000001', price: { unitCents: 1350 } } as unknown as NonNullable<
				Product['packs']
			> as never,
			skipped: null,
			picked: true,
			quoted: true,
			amount: { value: 1_000_000, unit: 'l' as const }
		};
		const w = sanityWarnings([{ item: { query: 'orange juice' }, pick } as never], k);
		expect(w[0]).toMatch(
			/^1,000,000 l of orange juice is 2,631.6 l per daily cover .*380 covers a day.*263.2× the 10 l per cover/
		);
		expect(w[1]).toMatch(/^€2,700,000 is 675× your €4,000 weekly limit$/);
	});

	it('a huge order is not placed until confirmed; the milk example passes unflagged', async () => {
		const { env } = await catalogue([]);
		const h = createHandlers(env.ports);
		const kitchen = (await env.store.kitchens(env.workspaceId)).find((k) => k.id === 'k-hotel')!;
		const deps = {
			handlers: h,
			ctx: {
				workspaceId: env.workspaceId,
				runId: env.runId,
				actor: { kind: 'kitchen_agent' as const, id: 'a' },
				scopes: SCOPES_BY_ACTOR.kitchen_agent,
				via: 'test'
			},
			today: TODAY,
			kitchen
		};
		const ok = await runRequest('1,000 L lactose-free milk by Monday', { ...deps, place: false });
		expect(ok.lookup!.sanity).toEqual([]);

		const big = await runRequest('1,000,000 l lactose-free milk by Monday', deps);
		expect(big.order).toBeNull();
		expect(big.needsConfirm).toBe(true);
		expect(big.lookup!.sanity.join(' ')).toMatch(/per daily cover/);
		expect(big.lookup!.sanity.join(' ')).toMatch(/× your €4,000 weekly limit/);

		const placed = await runRequest('1,000,000 l lactose-free milk by Monday', {
			...deps,
			confirmLarge: true
		});
		expect(placed.order?.plan.lines[0].qty.value).toBe(1_000_000);
		// Confirming the size places it, but €1.56M is over the mandate's hard limit: no approval can pass it.
		expect(placed.order?.plan.lines[0]).toMatchObject({ state: 'unorderable' });
		expect(placed.order?.plan.lines[0].reasons).toContain('over_hard_limit');
	}, 60_000);
});
