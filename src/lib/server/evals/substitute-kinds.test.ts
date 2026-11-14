/* eslint-disable @typescript-eslint/no-explicit-any -- wraps the catalogue port loosely for the probe */
/**
 * Substitution kinds (evals/retrieval/substitutes.json `kind`, the ladder in docs/research/substitutes.md): 1 same
 * product other pack · 2 same base other brand · 3 other form · 4 functional swap. Each labelled target is made out of
 * stock (every other product known and priced as quoted), then ranked by the real `find_substitutes` for the hotel.
 * - Order: a ranked kind-1/2 candidate never sits below a ranked kind-4 one for the same need. A chef asked for a
 *   ham; the same ham in other packs or from another brand comes before "kassler instead".
 * - Kind accuracy: once candidates carry a `kind` (8d, substitutes v2 (a)), it matches the label on ≥ 90% of labelled
 *   candidates. Skipped until then.
 * Needs the Valio catalogue in data/valio/ (gitignored); skipped without it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCOPES_BY_ACTOR } from '$lib/core/contracts';
import type { Catalog, CallContext } from '$lib/core/ports';
import { createHandlers } from '$lib/core/services/handlers';
import { createValioCatalog } from '$lib/server/adapters/catalog/valio';
import { createDbPorts } from '$lib/server/store/db-ports';

interface Label {
	productId: string;
	name: string;
	acceptable: { productId: string; grade: string; kind: 1 | 2 | 3 | 4 }[];
}
const hasData = existsSync(join('data', 'valio', 'valio_aimo_junction26_product_data.json'));
const set: { targets: Label[] } = JSON.parse(
	readFileSync(join('evals', 'retrieval', 'substitutes.json'), 'utf-8')
);

/**
 * Open: target ids whose ordering is still wrong, with the owner. Listed targets must still violate (red "looks
 * fixed" otherwise); unlisted ones must hold.
 */
const OPEN: Record<string, string> = {
	// Mustard herring: AIMO onion herring (same brand, other flavour) ranks 1st, Abba mustard herring 5th.
	'463876': '8d',
	// Lanttulaatikko (the demo's real outage): carrot casserole ranks above Feelia lanttulaatikko (6th).
	'462482': '8d'
};

/** The real catalogue, with the target out of stock and everything else known, so supply never decides the order. */
function outCatalog(inner: Catalog, out: string): Catalog {
	return {
		...inner,
		offers: async (ids, date) => {
			const r = await inner.offers(ids, date);
			return {
				...r,
				offers: r.offers.map((o: any) => ({
					...o,
					availability: {
						...o.availability,
						kind: o.productId === out ? 'out' : 'known',
						amount: o.productId === out ? 0 : 100000,
						logisticModel: 'Stock',
						availableDate: date
					}
				}))
			};
		}
	} as Catalog;
}

interface Ranked {
	target: string;
	ranked: { productId: string; rank: number; kind?: number; label?: number }[];
}
const results: Ranked[] = [];

describe.skipIf(!hasData)('suite: substitution kinds', () => {
	it('ranks every labelled target', { timeout: 600_000 }, async () => {
		const inner = createValioCatalog();
		for (const t of set.targets) {
			const built = await createDbPorts({
				catalog: outCatalog(inner, t.productId),
				workspaceId: `ws-kinds-${t.productId}`
			});
			const h = createHandlers(built.ports);
			const ctx = {
				workspaceId: `ws-kinds-${t.productId}`,
				runId: built.runId,
				actor: { kind: 'chef', id: 'kinds' },
				scopes: SCOPES_BY_ACTOR.chef,
				via: 'eval'
			} as CallContext;
			const p = (await inner.get([t.productId])).get(t.productId)!;
			const placed = await h.place_order(ctx, {
				kitchenId: 'k-hotel',
				deliverBy: '2026-12-11',
				idempotencyKey: `kinds-${t.productId}`,
				lines: [{ productId: t.productId, qty: p.lotStep || 1, unit: p.salesUnit }]
			});
			if (!placed.ok) continue;
			const plan = placed.value.plan;
			const r = await h.find_substitutes(ctx, {
				planId: plan.id,
				version: plan.version,
				lineId: plan.lines[0].id
			});
			if (!r.ok) continue;
			const label = new Map(t.acceptable.map((a) => [a.productId, a.kind]));
			results.push({
				target: t.productId,
				ranked: (r.value.candidates as any[])
					.filter((c) => c.rank !== null)
					.map((c) => ({
						productId: c.productId,
						rank: c.rank,
						kind: c.kind,
						label: label.get(c.productId)
					}))
			});
		}
		expect(results.length).toBeGreaterThan(set.targets.length / 2);
	});

	it('never ranks a same-product or same-base candidate below a functional swap', () => {
		const bad = results.flatMap((r) => {
			const worst4 = Math.min(
				...r.ranked.filter((c) => c.label === 4).map((c) => c.rank),
				Infinity
			);
			const below = r.ranked.filter((c) => (c.label === 1 || c.label === 2) && c.rank > worst4);
			return below.length
				? [
						{
							target: r.target,
							firstFunctionalRank: worst4,
							below: below.map((c) => `${c.productId}@${c.rank}`)
						}
					]
				: [];
		});
		const unexpected = bad.filter((b) => !OPEN[b.target]);
		const fixed = Object.keys(OPEN).filter((id) => !bad.some((b) => b.target === id));
		console.log(
			`kinds order: ${results.length} targets ranked, ${bad.length} with kind 1/2 below kind 4`
		);
		for (const b of bad)
			console.log(
				`  ${b.target}: first kind-4 at ${b.firstFunctionalRank}, below it ${b.below.join(' ')}`
			);
		expect(fixed, 'looks fixed: delete from OPEN').toEqual([]);
		expect(unexpected).toEqual([]);
	});

	// Open (8d + 91): the labels call any close dish swap "functional"; core names a swap functional only when a source
	// gives the dish role, else "different". Reconcile the definitions, then turn this back into a plain `it`.
	it.fails('names each labelled candidate with its kind (once candidates carry one)', (ctx) => {
		const labelled = results.flatMap((r) => r.ranked.filter((c) => c.label !== undefined));
		if (!labelled.some((c) => c.kind !== undefined)) ctx.skip();
		// Labels are the research ladder's numbers; core names the same rungs.
		const RUNG: Record<string, unknown> = { pack: 1, brand: 2, form: 3, functional: 4 };
		const right = labelled.filter((c) => RUNG[String(c.kind)] === c.label).length;
		console.log(`kind accuracy ${right}/${labelled.length}`);
		expect(right / labelled.length).toBeGreaterThanOrEqual(0.9);
	});
});
