/* eslint-disable @typescript-eslint/no-explicit-any -- wraps the catalogue port loosely for the probe */
/**
 * Do substitutes generalise beyond the 30 labelled targets? Opt-in (SUBS_GENERALISE=1; needs data/valio/), reports
 * numbers, asserts nothing about them. Report: scratch/subs-generalisation.json; summary in
 * docs/research/substitutes.md.
 *
 * 1. Leave-one-out on Valio's own substitution rules (ground truth we never tuned on). For each rule A→B: the
 *    candidate generator runs for A without that rule (A's other rules stay, as in production), then the real
 *    `find_substitutes` ranks for the hotel with A out and every other product in stock. Recorded: B's position in
 *    the retrieved top 12 (recall@12, MRR) and B's final rank (or why it was not ranked).
 * 2. Coverage on 100 food products, stratified by 2-digit category group (fixed seed): with A out and everything else
 *    in stock, how many get ≥ 1 ranked candidate, how many a same-base one (name-stem proxy: a candidate sharing the
 *    target's head word stem), how many get nothing retrieved at all.
 * Supply is neutral on purpose (all in stock but the target) so the numbers measure the generator and the ranker,
 * not which offers happen to be cached.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCOPES_BY_ACTOR, type Product } from '$lib/core/contracts';
import type { CallContext, Catalog } from '$lib/core/ports';
import { createHandlers } from '$lib/core/services/handlers';
import { createValioCatalog } from '$lib/server/adapters/catalog/valio';
import {
	assemble,
	RetrievalIndex,
	toRetrievalProduct
} from '$lib/server/adapters/catalog/retrieval';
import { createDbPorts } from '$lib/server/store/db-ports';
import { createFixtureDb } from '$lib/server/db/pglite';

const RUN =
	process.env.SUBS_GENERALISE === '1' &&
	existsSync(join('data', 'valio', 'valio_aimo_junction26_product_data.json'));
const K = 12;

/** Mulberry32: a fixed-seed sample that is the same on every run. */
function rng(seed: number) {
	return () => {
		seed |= 0;
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** The name's head word stem (first content word ≥ 4 letters that isn't the brand), a proxy for the base product. */
function headStem(p: Product): string | null {
	const brand = new Set((p.brand ?? '').toLowerCase().split(/\s+/));
	const w = p.nameFi
		.toLowerCase()
		.replace(/\d+([.,]\d+)?\s*(x|kg|g|l|dl|ml|cl|kpl|st|%)?/g, ' ')
		.split(/[^a-zåäö]+/)
		.find((x) => x.length >= 4 && !brand.has(x) && !/^(aimo|valio|uusi)$/.test(x));
	return w ? w.slice(0, 6) : null;
}
const sameBase = (a: Product, b: Product) => {
	const s = headStem(a);
	return s !== null && b.nameFi.toLowerCase().includes(s);
};

describe.skipIf(!RUN)('suite: substitute generalisation', () => {
	it(
		'measures leave-one-out recall on Valio rules and coverage on a stratified sample',
		{ timeout: 3_600_000 },
		async () => {
			const inner = createValioCatalog({ retrieval: 'hybrid' });
			const products = inner.products;
			const ix = new RetrievalIndex([...products.values()].map(toRetrievalProduct));
			// What the probe controls per run: A's candidate list and which product is out.
			let target = '';
			let pool: { productId: string; fromValioRule: boolean }[] | null = null;
			const catalog = {
				...inner,
				candidates: async (id: string, limit?: number) =>
					id === target && pool ? pool : inner.candidates(id, limit),
				offers: async (ids: string[], date: string) => {
					const r = await inner.offers(ids, date);
					const have = new Map(r.offers.map((o: any) => [o.productId, o]));
					const offers = ids.map((id) => {
						const fallback = {
							unitCents: 1000,
							comparison: null,
							taxRate: 14,
							validTo: null,
							provenance: { source: 'team_estimate', note: 'probe: price missing in cache' }
						};
						const o: any = have.get(id) ?? { productId: id, availability: {} };
						return {
							...o,
							// The offer cache lacks prices for many products: price is neutral here like supply.
							price: o.price?.unitCents ? o.price : fallback,
							availability: {
								...o.availability,
								kind: id === target ? 'out' : 'known',
								amount: id === target ? 0 : 100000,
								logisticModel: 'Stock',
								availableDate: date,
								closingTime: `${date}T17:00:00+02:00`,
								raw: null,
								provenance: o.availability?.provenance ?? { source: 'team_estimate', note: 'probe' }
							}
						};
					});
					return { offers, notFound: [] };
				}
			} as unknown as Catalog;
			const fx = await createFixtureDb();
			const built = await createDbPorts({ db: fx.db as never, catalog, workspaceId: 'ws-gen' });
			const h = createHandlers(built.ports);
			const ctx = {
				workspaceId: 'ws-gen',
				runId: built.runId,
				actor: { kind: 'chef', id: 'gen' },
				scopes: SCOPES_BY_ACTOR.chef,
				via: 'eval'
			} as CallContext;
			let n = 0;
			const rank = async (a: Product) => {
				const placed = await h.place_order(ctx, {
					kitchenId: 'k-hotel',
					deliverBy: '2026-12-11',
					idempotencyKey: `gen-${++n}`,
					lines: [{ productId: a.productId, qty: a.lotStep || 1, unit: a.salesUnit }]
				});
				if (!placed.ok) return { candidates: [] as any[], error: placed.error.code as string };
				const plan = placed.value.plan;
				const r = await h.find_substitutes(ctx, {
					planId: plan.id,
					version: plan.version,
					lineId: plan.lines[0].id
				});
				return r.ok
					? { candidates: r.value.candidates as any[], error: undefined as string | undefined }
					: { candidates: [] as any[], error: r.error.code as string };
			};

			// 1. Leave-one-out on Valio's rules.
			const loo: any[] = [];
			for (const a of products.values())
				for (const b of a.valioSubstitutes) {
					if (!products.has(b)) continue;
					const t = {
						...toRetrievalProduct(a),
						valioSubstitutes: a.valioSubstitutes.filter((x) => x !== b)
					};
					const got = assemble(
						t,
						(id) => products.has(id),
						(ex, room) => ix.similar(toRetrievalProduct(a), ex, room),
						K
					);
					const pos = got.findIndex((c) => c.productId === b) + 1;
					target = a.productId;
					pool = got.map((c) => ({ productId: c.productId, fromValioRule: c.fromValioRule }));
					const r = await rank(a);
					const c = r.candidates.find((x) => x.productId === b);
					loo.push({
						a: a.productId,
						aName: a.nameFi,
						b: b,
						bName: products.get(b)!.nameFi,
						group: a.categoryGroup,
						sameCategory: products.get(b)!.category === a.category,
						retrievedAt: pos || null,
						finalRank: c?.rank ?? null,
						why: c
							? c.rank === null
								? (c.rejectedReasons ?? c.state ?? [])
								: null
							: 'not retrieved',
						error: r.error
					});
				}
			pool = null;

			// 2. Coverage on a stratified sample of food products.
			const food = [...products.values()].filter(
				(p) => p.isFood && !p.dataQualityFlags.includes('old_flagged_name')
			);
			const groups = new Map<string, Product[]>();
			for (const p of food)
				groups.set(p.categoryGroup, [...(groups.get(p.categoryGroup) ?? []), p]);
			const rand = rng(20261114);
			const sample: Product[] = [];
			for (const [, ps] of [...groups].sort()) {
				const k = Math.max(3, Math.round((100 * ps.length) / food.length));
				const pick = [...ps].sort((x, y) => (x.productId < y.productId ? -1 : 1));
				for (let i = 0; i < k && pick.length; i++)
					sample.push(pick.splice(Math.floor(rand() * pick.length), 1)[0]);
			}
			const coverage: any[] = [];
			for (const a of sample.slice(0, 100)) {
				target = a.productId;
				const retrieved = await inner.candidates(a.productId, K);
				const r = await rank(a);
				const ranked = r.candidates.filter((c) => c.rank !== null);
				coverage.push({
					a: a.productId,
					aName: a.nameFi,
					group: a.categoryGroup,
					retrieved: retrieved.length,
					ranked: ranked.length,
					sameBase: ranked.filter((c) => sameBase(a, products.get(c.productId)!)).length,
					top: ranked.slice(0, 3).map((c) => products.get(c.productId)?.nameFi),
					reasons: [...new Set(r.candidates.flatMap((c: any) => c.rejectedReasons ?? []))],
					error: r.error
				});
			}

			// Summary.
			const N = loo.length;
			const hits = loo.filter((x) => x.retrievedAt);
			const mrr = loo.reduce((s, x) => s + (x.retrievedAt ? 1 / x.retrievedAt : 0), 0) / N;
			const ranked = loo.filter((x) => x.finalRank !== null);
			const top3 = loo.filter((x) => x.finalRank !== null && x.finalRank <= 3);
			const byGroup = (rows: any[], f: (x: any) => boolean) =>
				Object.fromEntries(
					[...new Set(rows.map((x) => x.group))].sort().map((g) => {
						const rs = rows.filter((x) => x.group === g);
						return [g, `${rs.filter(f).length}/${rs.length}`];
					})
				);
			const summary = {
				loo: {
					rules: N,
					recallAt12: +(hits.length / N).toFixed(3),
					mrr: +mrr.toFixed(3),
					rankedAtAll: +(ranked.length / N).toFixed(3),
					rankedTop3: +(top3.length / N).toFixed(3),
					heldByKitchenPolicy: loo.filter(
						(x) =>
							Array.isArray(x.why) &&
							x.why.some((w: string) => /UNKNOWN_REQUIRED|ALLERGEN|ORIGIN|FORBIDDEN/.test(w))
					).length,
					rankWhenRetrievedAndAllowed: (() => {
						const ok = loo.filter((x) => x.retrievedAt && x.finalRank !== null);
						const ranks = ok.map((x) => x.finalRank).sort((a: number, b: number) => a - b);
						return {
							n: ok.length,
							median: ranks[Math.floor(ranks.length / 2)] ?? null,
							top1: ranks.filter((r: number) => r === 1).length,
							top3: ranks.filter((r: number) => r <= 3).length
						};
					})(),
					whyNotRanked: Object.entries(
						loo
							.filter((x) => x.finalRank === null)
							.reduce((m: Record<string, number>, x) => {
								const k = JSON.stringify(x.why);
								m[k] = (m[k] ?? 0) + 1;
								return m;
							}, {})
					).sort((a, b) => b[1] - a[1]),
					sameCategoryShare: +(loo.filter((x) => x.sameCategory).length / N).toFixed(3),
					recallSameCategory: +(
						hits.filter((x) => x.sameCategory).length /
						Math.max(1, loo.filter((x) => x.sameCategory).length)
					).toFixed(3),
					recallOtherCategory: +(
						hits.filter((x) => !x.sameCategory).length /
						Math.max(1, loo.filter((x) => !x.sameCategory).length)
					).toFixed(3),
					hitsByGroup: byGroup(loo, (x) => x.retrievedAt)
				},
				coverage: {
					sample: coverage.length,
					anyRanked: coverage.filter((x) => x.ranked > 0).length,
					sameBaseRanked: coverage.filter((x) => x.sameBase > 0).length,
					nothingRetrieved: coverage.filter((x) => x.retrieved === 0).length,
					retrievedButNoneRanked: coverage.filter((x) => x.retrieved > 0 && x.ranked === 0).length,
					whyNoneRanked: Object.entries(
						coverage
							.filter((x) => x.retrieved > 0 && x.ranked === 0)
							.reduce((m: Record<string, number>, x) => {
								for (const w of x.reasons ?? []) m[w] = (m[w] ?? 0) + 1;
								return m;
							}, {})
					).sort((a, b) => b[1] - a[1]),
					anyRankedByGroup: byGroup(coverage, (x) => x.ranked > 0)
				}
			};
			mkdirSync('scratch', { recursive: true });
			writeFileSync(
				join('scratch', 'subs-generalisation.json'),
				JSON.stringify({ summary, loo, coverage }, null, '\t')
			);
			console.log(JSON.stringify(summary, null, 2));
			expect(loo.length).toBeGreaterThan(0);
		}
	);
});
