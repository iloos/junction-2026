/**
 * find_substitutes (PRODUCT ★3, D6 ranking). Candidate pool: Valio's own rules and same-category products from the
 * catalog, plus the event seed's hand-checked candidates and rescue options for that dish. Each candidate is sized
 * from the dish's served amount and its own yield and pack, ranked, and the winner proposed. When no product
 * qualifies, the seed's make-in-house recipe (sign-off tier) is proposed; otherwise the residual stays visible.
 */
import {
	err,
	ok,
	type Line,
	type LineReason,
	type Plan,
	type Product,
	type Result,
	type ToolInput,
	type ToolOutput
} from '../contracts';
import { roundToSales, type EventSeed, type SeedDish } from '../demand';
import { draftFromLine, type DraftLine } from '../mandate/tier';
import { rankCandidates } from '../rank/rank';
import type { CallContext } from '../ports';
import { requote, type ServicePorts } from './events';

/* eslint-disable @typescript-eslint/no-explicit-any -- seed candidate/rescue entries are loose JSON */
type Loose = any;

interface PoolEntry {
	productId: string;
	fromValioRule: boolean;
	yield?: number;
	pack?: Loose;
}

function rescueFor(seed: EventSeed | undefined, productId: string): Loose | undefined {
	const rescue = (seed as Loose)?.rescue;
	if (!rescue) return undefined;
	const key = Object.keys(rescue).find((k) => k.endsWith(`-${productId}`));
	return key ? rescue[key] : undefined;
}

/** Sales quantity of a candidate that serves the same amount as the original line's need. */
function sizeFor(
	p: Product,
	entry: PoolEntry,
	servedKg: number | null,
	line: Line
): { qty: Line['qty'] } | null {
	if (servedKg === null) return p.salesUnit === line.qty.unit ? { qty: line.qty } : null;
	const kg = servedKg / (entry.yield ?? 1);
	const pack =
		entry.pack ??
		(p.netPerSalesUnit?.value.unit === 'kg' && !p.catchWeight
			? { netKg: p.netPerSalesUnit.value.value }
			: undefined);
	if (!p.catchWeight && !pack) return null; // cannot size without a pack weight
	return {
		qty: roundToSales(
			{ value: +kg.toFixed(4), unit: 'kg' },
			{ salesUnit: p.salesUnit, lotStep: p.catchWeight ? p.lotStep : undefined, pack }
		)
	};
}

function unsizedReason(o: { availability: { kind: string } } | undefined): string {
	const k = o?.availability.kind;
	return k === 'out' || k === 'undeliverable' || k === 'blocked' ? k : 'UNKNOWN_REQUIRED';
}

/**
 * Re-sizes a product substitute after its dish's need changed (a g/guest edit): same yield and pack rules as when
 * it was ranked. Returns null when it can't be sized (then the line keeps its quantity).
 */
export function resizeSubstitute(
	seed: EventSeed | undefined,
	needLabel: string,
	servedKg: number,
	line: Line,
	p: Product
): Line['qty'] | null {
	const dish = seed?.dishes.find((d) => d.dish === needLabel) as Loose;
	const rescue = line.substituteFor ? rescueFor(seed, line.substituteFor) : undefined;
	const fromSeed = [
		...((dish?.candidates ?? []) as Loose[]),
		...((rescue?.alternatives ?? []) as Loose[]),
		...(rescue?.chosen?.productId ? [rescue.chosen] : [])
	].find((c) => c.productId === line.productId);
	const entry: PoolEntry = {
		productId: line.productId,
		fromValioRule: false,
		yield: fromSeed ? (fromSeed.yield ?? (rescue ? 1 : dish?.yield)) : dish?.yield,
		pack: fromSeed?.pack
	};
	return sizeFor(p, entry, servedKg, line)?.qty ?? null;
}

export async function findSubstitutes(
	ports: ServicePorts,
	ctx: CallContext,
	input: ToolInput<'find_substitutes'>
): Promise<Result<ToolOutput<'find_substitutes'>>> {
	const kitchens = await ports.store.kitchens(ctx.workspaceId);
	const pre = await ports.store.load(ctx.workspaceId, ctx.runId);
	const plan0 = pre.plans[input.planId];
	const line = plan0?.lines.find((l) => l.id === input.lineId);
	if (!plan0 || !line) return err('NOT_FOUND', `line ${input.lineId}`);
	if (plan0.version !== input.version)
		return err('STALE_VERSION', `plan is at v${plan0.version}, not v${input.version}`);
	const kitchen = kitchens.find((k) => k.id === plan0.kitchenId);
	if (!kitchen) return err('NOT_FOUND', `kitchen ${plan0.kitchenId}`);
	const existing = plan0.lines.find(
		(l) => l.substituteFor === line.productId && l.needId === line.needId
	);
	// Per-call weights / origin re-rank without persisting (the "Your rules" beat); so does asking again.
	const preview = Boolean(input.weights || input.requireOrigin || existing);
	const rankKitchen = input.weights ? { ...kitchen, weights: input.weights } : kitchen;

	const seed = plan0.eventId ? ports.events?.[plan0.eventId] : undefined;
	const need = plan0.needs.find((n) => n.id === line.needId);
	const dish: SeedDish | undefined = seed?.dishes.find((d) => d.dish === need?.label);
	const rescue = rescueFor(seed, line.productId);
	const servedKg =
		need && need.amount.unit === 'kg' ? need.amount.value * (dish?.yield ?? 1) : null;

	// Pool: catalog (Valio rules first, then same category) + the seed's candidates and rescue products.
	const pool = new Map<string, PoolEntry>();
	const add = (e: PoolEntry) => {
		if (e.productId === line.productId) return;
		const prev = pool.get(e.productId);
		pool.set(e.productId, {
			...prev,
			...e,
			fromValioRule: (prev?.fromValioRule ?? false) || e.fromValioRule
		});
	};
	for (const c of await ports.catalog.candidates(line.productId, 12))
		add({ productId: c.productId, fromValioRule: c.fromValioRule, yield: dish?.yield });
	for (const c of ((dish as Loose)?.candidates ?? []) as Loose[])
		add({
			productId: c.productId,
			fromValioRule: false,
			yield: c.yield ?? dish?.yield,
			pack: c.pack
		});
	for (const c of (rescue?.alternatives ?? []) as Loose[])
		add({ productId: c.productId, fromValioRule: false, yield: c.yield ?? 1, pack: c.pack });
	if (rescue?.chosen?.productId)
		add({
			productId: rescue.chosen.productId,
			fromValioRule: false,
			yield: rescue.chosen.yield ?? 1,
			pack: rescue.chosen.pack
		});

	const ids = [...pool.keys()];
	const [products, { offers }] = await Promise.all([
		ports.catalog.get(ids),
		ports.catalog.offers(ids, plan0.deliverBy)
	]);
	const sized = new Map<string, Line['qty']>();
	const unsized: string[] = [];
	for (const [id, e] of pool) {
		const p = products.get(id);
		const s = p ? sizeFor(p, e, servedKg, line) : null;
		if (s) sized.set(id, s.qty);
		else unsized.push(id);
	}
	const ranked = rankCandidates({
		kitchen: rankKitchen,
		candidates: [...sized].map(([productId, qty]) => ({
			productId,
			fromValioRule: pool.get(productId)!.fromValioRule,
			qty: qty.value
		})),
		products,
		offers: new Map(offers.map((o) => [o.productId, o]))
	});
	if (input.requireOrigin) {
		for (const r of ranked)
			if (r.rank !== null && products.get(r.productId)?.origin !== input.requireOrigin) {
				r.rank = null;
				r.score = undefined;
				r.rejectedReasons = ['origin_required'];
			}
		let n = 1;
		for (const r of ranked.filter((x) => x.rank !== null).sort((a, b) => a.rank! - b.rank!))
			r.rank = n++;
	}
	const nameOf = (id: string) => products.get(id)?.nameFi;
	const candidates = [
		...ranked.map((r) => ({
			productId: r.productId,
			productName: nameOf(r.productId),
			rank: r.rank,
			score: r.score,
			rejectedReasons: r.rejectedReasons as string[],
			fromValioRule: r.fromValioRule
		})),
		...unsized.map((productId) => ({
			productId,
			productName: nameOf(productId),
			rank: null,
			// Availability is the true reason when it already excludes the product; otherwise it can't be sized.
			rejectedReasons: [unsizedReason(offers.find((o) => o.productId === productId))],
			fromValioRule: pool.get(productId)!.fromValioRule
		}))
	];

	const best = ranked.filter((r) => r.rank !== null).sort((a, b) => a.rank! - b.rank!)[0];
	let kind: 'product' | 'make_in_house' | 'none' = 'product';
	let labourNote: string | undefined;
	let drafts: DraftLine[] = [];
	if (best)
		drafts = [
			{
				id: `${line.id}-sub-${best.productId}`,
				needId: line.needId,
				productId: best.productId,
				qty: sized.get(best.productId)!,
				substituteFor: line.productId,
				provenance: {
					source: 'valio_static',
					note: `substitute for ${line.productId}, rank 1 of ${ranked.filter((r) => r.rank).length}`
				}
			}
		];
	else if (rescue?.chosen?.kind === 'make_in_house') {
		kind = 'make_in_house';
		labourNote = rescue.chosen.recipe?.labour;
		const extra: LineReason[] = ['allergen_change'];
		drafts = (rescue.chosen.ingredients as Loose[]).map((g) => ({
			id: `${line.id}-mih-${g.productId}`,
			needId: line.needId,
			productId: g.productId,
			qty: { value: g.order.qty, unit: g.order.unit, rounding: g.need },
			substituteFor: line.productId,
			extraReasons: extra,
			provenance: {
				source: 'team_estimate',
				ref: 'fixtures/seeds/christmas-buffet-140.json',
				note: rescue.chosen.recipe?.provenance ?? 'make in house'
			}
		}));
	} else kind = 'none';
	const residual = kind === 'none' && need ? need.amount : undefined;
	const proposedOf = (d: DraftLine): Line => ({
		...d,
		productName: nameOf(d.productId),
		state: 'proposed',
		reasons: [],
		offer: null,
		lineCents: null
	});
	if (preview) {
		const already = plan0.lines.filter(
			(l) => l.substituteFor === line.productId && l.needId === line.needId
		);
		return ok({
			plan: plan0,
			kind: existing ? (existing.id.includes('-mih-') ? 'make_in_house' : 'product') : kind,
			chosen: existing ? already : drafts.map(proposedOf),
			candidates,
			labourNote,
			residual
		});
	}

	const r = await ports.store.transact<{ plan: Plan; chosen: Line[] }>(
		ctx.workspaceId,
		async (tx, state) => {
			const plan = state.plans[input.planId];
			if (!plan || plan.version !== input.version)
				return {
					error: err('STALE_VERSION', 'the plan changed while substitutes were ranked').error
				};
			const proposed: Line[] = drafts.map(proposedOf);
			const op = {
				workspaceId: ctx.workspaceId,
				runId: ctx.runId,
				actor: ctx.actor,
				via: ctx.via,
				op: {
					type: 'ProposeSubstitute' as const,
					planId: plan.id,
					baseVersion: plan.version,
					forLineId: line.id,
					kind: kind === 'make_in_house' ? ('make_in_house' as const) : ('product' as const),
					lines: proposed,
					labourNote,
					candidates
				}
			};
			const after: Plan = {
				...plan,
				version: plan.version + 1,
				state: 'draft',
				termsHash: null,
				lines: [...plan.lines, ...proposed]
			};
			const open = after.lines
				.filter((l) => l.state !== 'committed')
				.map<DraftLine>((l) => drafts.find((d) => d.id === l.id) ?? draftFromLine(l));
			const q = await requote(ports, ctx, tx, state, after, kitchen, open);
			return {
				ops: [op, ...q.ops],
				value: {
					plan: q.plan,
					chosen: q.plan.lines.filter((l) => drafts.some((d) => d.id === l.id))
				}
			};
		}
	);
	return r.ok ? ok({ ...r.value.value, kind, candidates, labourNote, residual }) : r;
}
