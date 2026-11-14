/* eslint-disable @typescript-eslint/no-explicit-any -- wraps the catalogue port loosely for the probe */
/**
 * Ranking presets (lib/kitchen/view-model.ts PRESETS, the Kitchen's rules panel; /request "Rank by" and chat reuse
 * them). Each of the 30 labelled substitute targets (evals/retrieval/substitutes.json) is made out of stock, every
 * other product in stock at its quoted price, and ranked by the real `find_substitutes` for the hotel under the
 * kitchen's own weights and under each preset (per-call `weights`, plus `requireOrigin` for Finnish required).
 * - A weight change never changes what may be ordered: every candidate keeps its state, tier and reasons when only
 *   the weights change. Weights reorder; they never authorise.
 * - Each preset picks what it promises among the eligible candidates, against the kitchen default's first pick:
 *   Price first never picks dearer, Lowest carbon never higher CO2, Most reliable never less reliable, Finnish
 *   required ranks only Finnish products. A preset that doesn't exist yet is skipped until it lands.
 * Needs the Valio catalogue in data/valio/ (gitignored); skipped without it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCOPES_BY_ACTOR, type Product } from '$lib/core/contracts';
import type { CallContext, Catalog } from '$lib/core/ports';
import { createHandlers } from '$lib/core/services/handlers';
import { createValioCatalog } from '$lib/server/adapters/catalog/valio';
import { createDbPorts, loadSeedKitchens } from '$lib/server/store/db-ports';
import { PRESETS, rulesFor, type PresetId } from '$lib/kitchen/view-model';

const hasData = existsSync(join('data', 'valio', 'valio_aimo_junction26_product_data.json'));
const targets = (
	JSON.parse(readFileSync(join('evals', 'retrieval', 'substitutes.json'), 'utf-8')) as {
		targets: { productId: string }[];
	}
).targets.map((t) => t.productId);

interface Cand {
	productId: string;
	rank: number | null;
	state?: string;
	tier?: string;
	rejectedReasons?: string[];
}
interface Run {
	target: string;
	preset: string;
	candidates: Cand[];
}

/** Which axis a preset promises, by its id; undefined = no ordering promise (the kitchen's own weights). */
function promise(id: string): 'price' | 'carbon' | 'reliability' | 'finnish' | undefined {
	if (/price|cheap/i.test(id)) return 'price';
	if (/carbon|co2/i.test(id)) return 'carbon';
	if (/reliab/i.test(id)) return 'reliability';
	if (/finn/i.test(id)) return 'finnish';
	return undefined;
}
const PROMISES = ['price', 'carbon', 'reliability', 'finnish'] as const;

describe.skipIf(!hasData)('suite: ranking presets', () => {
	const runs: Run[] = [];
	const offerOf = new Map<string, any>();
	let products: Map<string, Product>;

	it(
		'ranks every target under the kitchen default and each preset',
		{ timeout: 900_000 },
		async () => {
			const inner = createValioCatalog();
			products = inner.products;
			let out = '';
			const catalog = {
				...inner,
				offers: async (ids: string[], date: string) => {
					const r = await inner.offers(ids, date);
					const have = new Map(r.offers.map((o: any) => [o.productId, o]));
					const offers = ids.map((id) => {
						const o: any = have.get(id) ?? { productId: id, availability: {} };
						const priced = o.price?.unitCents
							? o.price
							: {
									unitCents: 1000,
									comparison: null,
									taxRate: 14,
									validTo: null,
									provenance: { source: 'team_estimate', note: 'probe: no cached price' }
								};
						const x = {
							...o,
							price: priced,
							availability: {
								...o.availability,
								kind: id === out ? 'out' : 'known',
								amount: id === out ? 0 : 100000,
								logisticModel: 'Stock',
								availableDate: date,
								closingTime: `${date}T17:00:00+02:00`,
								raw: null,
								provenance: o.availability?.provenance ?? { source: 'team_estimate', note: 'probe' }
							}
						};
						offerOf.set(id, x);
						return x;
					});
					return { offers, notFound: [] };
				}
			} as unknown as Catalog;
			const built = await createDbPorts({ catalog, workspaceId: 'ws-presets' });
			const h = createHandlers(built.ports);
			const ctx = {
				workspaceId: 'ws-presets',
				runId: built.runId,
				actor: { kind: 'chef', id: 'presets' },
				scopes: SCOPES_BY_ACTOR.chef,
				via: 'eval'
			} as CallContext;
			const hotel = loadSeedKitchens().find((k) => k.id === 'k-hotel')!;
			const presets = Object.keys(PRESETS) as PresetId[];
			let n = 0;
			for (const t of targets) {
				const p = products.get(t);
				if (!p) continue;
				out = t;
				const placed = await h.place_order(ctx, {
					kitchenId: 'k-hotel',
					deliverBy: '2026-12-11',
					idempotencyKey: `presets-${++n}`,
					lines: [{ productId: t, qty: p.lotStep || 1, unit: p.salesUnit }]
				});
				if (!placed.ok) continue;
				const plan = placed.value.plan;
				for (const preset of presets) {
					const weights = rulesFor(hotel, preset).weights as Record<string, number>;
					const r = await h.find_substitutes(ctx, {
						planId: plan.id,
						version: plan.version,
						lineId: plan.lines[0].id,
						weights,
						...(promise(preset) === 'finnish' ? { requireOrigin: 'fi' } : {})
					});
					if (r.ok) runs.push({ target: t, preset, candidates: r.value.candidates as Cand[] });
				}
			}
			expect(runs.length).toBeGreaterThan(targets.length);
		}
	);

	it('a weight change never changes a candidate state, tier or reasons', () => {
		const changed: string[] = [];
		for (const t of targets) {
			const weightOnly = runs.filter((r) => r.target === t && promise(r.preset) !== 'finnish');
			const base = weightOnly.find((r) => r.preset === 'kitchen');
			if (!base) continue;
			const key = (c: Cand) =>
				`${c.state ?? ''}|${c.tier ?? ''}|${[...(c.rejectedReasons ?? [])].sort().join(',')}`;
			const at = new Map(base.candidates.map((c) => [c.productId, key(c)]));
			for (const r of weightOnly)
				for (const c of r.candidates)
					if (at.has(c.productId) && at.get(c.productId) !== key(c))
						changed.push(`${t} ${r.preset} ${c.productId}: ${at.get(c.productId)} → ${key(c)}`);
		}
		expect(changed).toEqual([]);
	});

	for (const axis of PROMISES)
		it(`the ${axis} preset picks what it promises among the eligible`, (ctx) => {
			const id = (Object.keys(PRESETS) as string[]).find((p) => promise(p) === axis);
			if (!id) ctx.skip();
			const value = (pid: string): number | null => {
				const o = offerOf.get(pid);
				const q = products.get(pid);
				if (axis === 'price')
					// A placeholder price (nothing cached) compares nothing.
					return /^probe/.test(o?.price?.provenance?.note ?? '')
						? null
						: (o?.price?.comparison?.cents ?? o?.price?.unitCents ?? null);
				if (axis === 'carbon') return q?.co2PerKg?.value ?? null;
				if (axis === 'reliability') return q?.reliability ?? null;
				return q?.origin === 'fi' ? 1 : 0;
			};
			const worse: string[] = [];
			for (const t of targets) {
				const first = (r?: Run) => r?.candidates.find((c) => c.rank === 1)?.productId;
				const mine = first(runs.find((r) => r.target === t && r.preset === id));
				const base = first(runs.find((r) => r.target === t && r.preset === 'kitchen'));
				if (axis === 'finnish') {
					const ranked = runs
						.find((r) => r.target === t && r.preset === id)
						?.candidates.filter((c) => c.rank !== null);
					const foreign = (ranked ?? []).filter((c) => value(c.productId) !== 1);
					if (foreign.length)
						worse.push(`${t}: ranks non-Finnish ${foreign.map((c) => c.productId)}`);
					continue;
				}
				if (!mine || !base) continue;
				const a = value(mine);
				const b = value(base);
				if (a === null || b === null) continue;
				const ok = axis === 'reliability' ? a >= b - 1e-9 : a <= b + 1e-9;
				if (!ok) worse.push(`${t}: ${id} picks ${mine} (${a}) over the default's ${base} (${b})`);
			}
			console.log(`${axis} preset "${id}": ${worse.length} worse than the kitchen default`);
			expect(worse).toEqual([]);
		});
});
