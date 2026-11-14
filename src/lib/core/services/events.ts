/**
 * Event planning (PRODUCT ★2 ★8): an event seed → needs → pack-rounded lines → quote + tier, as one plan.
 * A g/guest edit recomputes that need's lines and re-quotes in the same call (one EditLine + RecordOffer).
 * The Why drawer reads the same numbers back: dish → g/guest × guests ÷ yield → need → rounding → price → tier.
 */
import {
	err,
	ok,
	type Kitchen,
	type Line,
	type MenuProposal,
	type Need,
	type Offer,
	type Plan,
	type Product,
	type Result,
	type ToolInput,
	type ToolOutput
} from '../contracts';
import { sha256Hex } from '../hash';
import { SCENARIO, addDays } from '../scenario';
import {
	makeInHouseQty,
	menuDemand,
	convertAmount,
	menuDigest,
	menuOverrides,
	planEventDemand,
	rescueFor,
	seedEntryFor,
	seedNeedQty,
	sizeDirect,
	sizeFor,
	type EventSeed,
	type MenuNeed
} from '../demand';
import {
	draftFromLine,
	isoWeek,
	tierLines,
	type DraftLine,
	orderedBefore,
	recalledProducts
} from '../mandate/tier';
import type { CallContext, Ports, Tx } from '../ports';
import type { WorkspaceState } from '../state';
import { kitchenOf, pending, quoteOps, toLot } from './orders';
import { AVAILABILITY_WORDING } from './wording';

/** Ports plus the event seeds the server loaded (core reads no files). */
export type ServicePorts = Ports & { events?: Record<string, EventSeed> };

/** The delivery for an event: the scenario's delivery for the scenario's event, otherwise two days before it. */
export function deliverByFor(eventDate: string): string {
	if (eventDate === SCENARIO.event) return SCENARIO.delivery;
	return addDays(eventDate, -2);
}

/** g/guest overrides are kept on the need's provenance so a later edit or explain can rebuild the numbers. */
const OVERRIDE = /^gServed=(\d+(?:\.\d+)?)$/;
function overridesOf(plan: Plan): Record<string, number> {
	const out: Record<string, number> = {};
	for (const n of plan.needs) {
		const m = n.provenance.note?.match(OVERRIDE);
		if (m) out[n.id] = Number(m[1]);
	}
	return out;
}

function demandLines(planId: string, seed: EventSeed, overrides: Record<string, number>) {
	const d = planEventDemand(seed, { gServedOverrides: overrides });
	const guests = seed.guests.estimate;
	const needs: Need[] = d.needs.map((n) => {
		const withNote =
			overrides[n.id] !== undefined
				? { ...n, provenance: { ...n.provenance, note: `gServed=${overrides[n.id]}` } }
				: n;
		// The editable g/guest and how the need follows from it (kitchen table + Why drawer).
		const dish = seed.dishes.find((x) => x.dish === n.label);
		if (dish?.gServed === undefined) return withNote;
		const g = overrides[n.id] ?? dish.gServed;
		const y = dish.yield ?? 1;
		const amount = `${n.amount.value.toFixed(n.amount.value < 10 ? 2 : 1)} ${n.amount.unit}`;
		// A cooked dish (rice porridge): g/guest sizes the dish, and the ingredient is a share of it per kg.
		const perKg = dish.perKgDish
			? Object.entries(dish.perKgDish).find(([k]) => k.endsWith('Kg'))
			: undefined;
		const formula = perKg
			? `${g} g dish × ${guests} = ${((g * guests) / 1000).toFixed(1)} kg cooked × ${perKg[1]} = ${amount}`
			: `${g} g × ${guests}${y !== 1 ? ` ÷ ${y.toFixed(2)}` : ''} = ${amount}`;
		return {
			...withNote,
			dish: { gServed: g, defaultGServed: dish.gServed, guests, yield: y, formula }
		};
	});
	const drafts: DraftLine[] = d.lines.map((l) => ({
		id: `${planId}-${l.needId}`,
		needId: l.needId,
		productId: l.productId,
		qty: l.qty,
		provenance: {
			source: 'team_estimate',
			ref: 'fixtures/seeds/christmas-buffet-140.json',
			note: l.dish
		}
	}));
	return { needs, drafts };
}

/** Catalogue data a quote needs, fetched before the transaction (never inside it: D6). */
export interface Prefetched {
	offers: Offer[];
	products: Map<string, Product>;
}

export async function prefetch(
	ports: Ports,
	ids: string[],
	deliverBy: string
): Promise<Prefetched> {
	const unique = [...new Set(ids)];
	const [{ offers }, products] = await Promise.all([
		ports.catalog.offers(unique, deliverBy),
		ports.catalog.get(unique)
	]);
	return { offers, products };
}

/**
 * Tiers the open drafts (committed lines stay) and returns the quote ops for the plan. Runs inside the transaction
 * on prefetched catalogue data; only the budget row is read here, through the transaction.
 */
export async function requote(
	ports: ServicePorts,
	ctx: CallContext,
	tx: Tx,
	state: WorkspaceState,
	plan: Plan,
	kitchen: Kitchen,
	drafts: DraftLine[],
	pre: Prefetched
) {
	const spent = await ports.store.lockBudget(tx, {
		workspaceId: ctx.workspaceId,
		kitchenId: kitchen.id,
		week: isoWeek(plan.deliverBy)
	});
	const t = tierLines({
		now: ports.clock.now(),
		kitchen,
		lines: drafts,
		offers: new Map(pre.offers.map((o) => [o.productId, o])),
		products: pre.products,
		weekSpentCents: spent,
		actor: ctx.actor.kind,
		createdBy: plan.createdBy.kind,
		orderedBefore: orderedBefore(state, kitchen),
		recalled: recalledProducts(state),
		committed: plan.lines.filter((l) => l.state === 'committed'),
		expectedQty: expectedFor(ports, plan, drafts, pre.products),
		needs: plan.needs,
		deliverBy: plan.deliverBy
	});
	return quoteOps(ctx, ports, plan, kitchen, t, pre.offers);
}

/**
 * What each line serving a dish needs, by line id: the seed's per-line need for a seeded event, the need's amount
 * sized to the line's product for a menu plan (none for a direct order). Beyond 20× it a quantity is a gap.
 */
export function expectedFor(
	ports: ServicePorts,
	plan: Plan,
	drafts: readonly DraftLine[] = [],
	products?: Map<string, Product>
) {
	const seed = plan.eventId ? ports.events?.[plan.eventId] : undefined;
	if (seed) return seedNeedQty(plan.id, seed);
	if (!plan.source || !products) return undefined;
	const out = new Map<string, { productId: string; value: number }>();
	for (const d of drafts) {
		const need = plan.needs.find((n) => n.id === d.needId);
		const p = products.get(d.productId);
		const qty = need?.source && p ? sizeDirect(p, need.amount) : null;
		if (qty) out.set(d.id, { productId: d.productId, value: qty.value });
	}
	return out;
}

const conflict = (what: string) => ({
	error: err('STALE_VERSION', `${what} changed while this call was prepared; reload and retry`)
		.error
});

/** Who a new plan is for beyond the tool input (Ring 2: the procurement task that asked for it). */
export interface PlanOptions {
	taskId?: string;
}

export async function planEvent(
	ports: ServicePorts,
	ctx: CallContext,
	input: ToolInput<'plan_event'>,
	opts: PlanOptions = {}
): Promise<Result<ToolOutput<'plan_event'>>> {
	if (input.proposal) return planProposal(ports, ctx, input.kitchenId, input.proposal, opts);
	if (input.eventId === undefined)
		return err('INVALID_INPUT', 'give a seeded eventId or a chef-reviewed menu proposal');
	const seed = ports.events?.[input.eventId];
	if (!seed) return err('NOT_FOUND', `event ${input.eventId}`);
	const kitchen = await kitchenOf(ports, ctx, input.kitchenId);
	if (!kitchen) return err('NOT_FOUND', `kitchen ${input.kitchenId}`);
	const planId = `pl-${ctx.runId}-${(await sha256Hex(`event|${kitchen.id}|${input.eventId}`)).slice(0, 12)}`;
	const existing = (await ports.store.load(ctx.workspaceId, ctx.runId)).plans[planId];
	if (existing) return ok({ plan: existing }); // one plan per (kitchen, event): planning again is a read

	// Prepare outside the transaction: demand is pure, the catalogue is read once.
	const { needs, drafts } = demandLines(planId, seed, {});
	const deliverBy = deliverByFor(seed.date);
	const pre = await prefetch(
		ports,
		drafts.map((d) => d.productId),
		deliverBy
	);
	const r = await ports.store.transact<Plan>(ctx.workspaceId, async (tx, state) => {
		if (state.plans[planId]) return { ops: [], value: state.plans[planId] }; // planned meanwhile
		const plan0: Plan = {
			workspaceId: ctx.workspaceId,
			runId: ctx.runId,
			id: planId,
			kitchenId: kitchen.id,
			version: 0,
			state: 'draft',
			deliverBy,
			eventId: input.eventId,
			...(opts.taskId ? { taskId: opts.taskId } : {}),
			needs,
			lines: [],
			totalCents: null,
			termsHash: null,
			createdBy: ctx.actor,
			...(ctx.origin ? { origin: ctx.origin } : {})
		};
		const q = await requote(ports, ctx, tx, state, plan0, kitchen, drafts, pre);
		return { ops: [pending(ctx, { type: 'CreatePlan', plan: plan0 }), ...q.ops], value: q.plan };
	});
	return r.ok ? ok({ plan: r.value.value }) : r;
}

/**
 * The stored revision, only when the server's review record covers exactly it: status chef_reviewed, a review, and
 * the review's digest equal to the revision's terms now. A client can't establish a review by sending a status.
 */
export async function reviewedProposal(
	ports: ServicePorts,
	ctx: CallContext,
	ref: { id: string; revision: number }
): Promise<Result<MenuProposal>> {
	if (!ports.menus)
		return err('PROVIDER_UNAVAILABLE', 'menu proposals are not available on this server');
	const p = await ports.menus.get(ctx.workspaceId, ref.id, ref.revision);
	if (!p) return err('NOT_FOUND', `menu ${ref.id} revision ${ref.revision}`);
	if (p.status !== 'chef_reviewed' || !p.review || p.review.digest !== (await menuDigest(p)))
		return err(
			'FORBIDDEN',
			`menu ${ref.id} revision ${ref.revision} has no chef review on record: a chef reviews it before it is planned`,
			{
				sub: 'review_required',
				detail: { proposalId: ref.id, revision: ref.revision, status: p.status }
			}
		);
	return ok(p);
}

/**
 * A menu need as a plan need and, when its product is known and can be sized, the line that buys it: the need's
 * physical amount in the product's sales units, rounded up to whole lots. A need that can't be sized keeps a reason.
 */
function menuLine(
	planId: string,
	item: MenuNeed,
	products: Map<string, Product>
): { need: Need; draft?: DraftLine } {
	const { need } = item;
	if (item.unresolved || !item.productId) return { need };
	const p = products.get(item.productId);
	if (!p)
		return { need: { ...need, unresolved: `product ${item.productId} is not in the catalogue` } };
	const qty = sizeDirect(p, need.amount);
	if (!qty)
		return {
			need: {
				...need,
				unresolved: `${p.nameFi}: content per ${p.salesUnit} in ${need.amount.unit} is unknown; set a quantity or pick another product`
			}
		};
	return {
		need,
		draft: {
			id: `${planId}-${need.id}`,
			needId: need.id,
			productId: item.productId,
			qty,
			strategy: { id: `${need.id}:buy`, kind: 'buy' },
			provenance: {
				source: need.provenance.source,
				ref: need.provenance.ref,
				note: need.dish?.formula
			}
		}
	};
}

/**
 * plan_event{proposal}: a chef-reviewed menu revision → one need per dish ingredient (lineage on Need.source) → a
 * line sized to each pinned product → quote + tier, as one plan. Deterministic: no model, no retrieval. One plan per
 * (kitchen, proposal revision); planning it again is a read.
 */
async function planProposal(
	ports: ServicePorts,
	ctx: CallContext,
	kitchenId: string,
	ref: { id: string; revision: number },
	opts: PlanOptions
): Promise<Result<ToolOutput<'plan_event'>>> {
	const reviewed = await reviewedProposal(ports, ctx, ref);
	if (!reviewed.ok) return reviewed;
	const proposal = reviewed.value;
	if (proposal.kitchenId !== kitchenId)
		return err(
			'INVALID_INPUT',
			`menu ${ref.id} is for kitchen ${proposal.kitchenId}, not ${kitchenId}`
		);
	const kitchen = await kitchenOf(ports, ctx, kitchenId);
	if (!kitchen) return err('NOT_FOUND', `kitchen ${kitchenId}`);
	const planId = `pl-${ctx.runId}-${(await sha256Hex(`menu|${kitchen.id}|${ref.id}|${ref.revision}`)).slice(0, 12)}`;
	const existing = (await ports.store.load(ctx.workspaceId, ctx.runId)).plans[planId];
	if (existing) return ok({ plan: existing });

	const items = menuDemand(proposal);
	const deliverBy = deliverByFor(proposal.brief.date);
	const pre = await prefetch(
		ports,
		items.flatMap((i) => (i.productId && !i.unresolved ? [i.productId] : [])),
		deliverBy
	);
	const sized = items.map((i) => menuLine(planId, i, pre.products));
	const needs = sized.map((x) => x.need);
	const drafts = sized.flatMap((x) => (x.draft ? [x.draft] : []));
	const r = await ports.store.transact<Plan>(ctx.workspaceId, async (tx, state) => {
		if (state.plans[planId]) return { ops: [], value: state.plans[planId] };
		const plan0: Plan = {
			workspaceId: ctx.workspaceId,
			runId: ctx.runId,
			id: planId,
			kitchenId: kitchen.id,
			version: 0,
			state: 'draft',
			deliverBy,
			source: { proposalId: proposal.id, revision: proposal.revision },
			...(opts.taskId ? { taskId: opts.taskId } : {}),
			needs,
			lines: [],
			totalCents: null,
			termsHash: null,
			createdBy: ctx.actor,
			...(ctx.origin ? { origin: ctx.origin } : {})
		};
		const q = await requote(ports, ctx, tx, state, plan0, kitchen, drafts, pre);
		return { ops: [pending(ctx, { type: 'CreatePlan', plan: plan0 }), ...q.ops], value: q.plan };
	});
	return r.ok ? ok({ plan: r.value.value }) : r;
}

interface PreparedEdit {
	plan: Plan;
	kitchen: Kitchen;
	drafts: DraftLine[];
	need?: Need;
	/** Needs that follow the edited one (rice porridge's milk follows its rice): each gets its own EditLine. */
	dependents?: Need[];
	changed: string[];
	summary: string;
}

/** Everything an edit needs, computed from the loaded plan and the catalogue before any lock is taken. */
async function prepareEdit(
	ports: ServicePorts,
	ctx: CallContext,
	input: ToolInput<'edit_line'>
): Promise<Result<PreparedEdit>> {
	const [kitchens, loaded] = await Promise.all([
		ports.store.kitchens(ctx.workspaceId),
		ports.store.load(ctx.workspaceId, ctx.runId)
	]);
	const plan = loaded.plans[input.planId];
	if (!plan) return err('NOT_FOUND', `plan ${input.planId}`);
	if (plan.version !== input.version)
		return err('STALE_VERSION', `plan is at v${plan.version}, not v${input.version}`);
	const kitchen = kitchens.find((k) => k.id === plan.kitchenId);
	if (!kitchen) return err('NOT_FOUND', `kitchen ${plan.kitchenId}`);
	let drafts = plan.lines.filter((l) => l.state !== 'committed').map(draftFromLine);

	if (input.needId && input.patch.amount) {
		// R9-03: an amount amendment changes the need itself and re-sizes its lines; never a purchase-only edit.
		const before = plan.needs.find((n) => n.id === input.needId);
		if (!before) return err('NOT_FOUND', `need ${input.needId}`);
		const amount = input.patch.amount;
		if (before.dish)
			return err('INVALID_INPUT', `${before.label} is a dish: change its g/guest, not its amount`, {
				detail: { needId: before.id, field: 'gramsPerGuest' }
			});
		if (amount.unit !== before.amount.unit) {
			// Never applied silently: with this product's own density the refusal carries the converted amount for the
			// caller to confirm ("20 kg is about 19.4 l; order that?"), without it a question for the unit.
			const bought = plan.lines.find(
				(l) => l.needId === before.id && l.state !== 'committed' && l.qty.value > 0
			);
			const product = bought
				? (await ports.catalog.get([bought.productId])).get(bought.productId)
				: undefined;
			const c = convertAmount(amount.value, amount.unit, before.amount.unit, product);
			const detail = {
				needId: before.id,
				needUnit: before.amount.unit,
				given: amount.unit,
				...(c.ok ? { converted: c.amount, source: c.note } : { why: c.reason })
			};
			return err(
				'INVALID_INPUT',
				c.ok
					? `${amount.value} ${amount.unit} of ${product?.nameFi ?? before.label} is about ${c.amount.value} ${c.amount.unit} (${c.note}). Confirm ${c.amount.value} ${c.amount.unit}?`
					: `${before.label} is measured in ${before.amount.unit}, and ${c.note}. Say it in ${before.amount.unit}.`,
				{ detail }
			);
		}
		if (plan.lines.some((l) => l.needId === before.id && l.state === 'committed'))
			return err('STALE_VERSION', 'a line of this need is already committed');
		const mine = drafts.filter((d) => d.needId === before.id);
		const products = await ports.catalog.get(mine.map((d) => d.productId));
		// Lines bought for this need follow it; a superseded line stays at 0. Nothing to buy at 0.
		drafts = drafts.map((d) => {
			if (d.needId !== before.id || d.extraReasons?.includes('superseded') || d.qty.value === 0)
				return d;
			if (amount.value === 0) return { ...d, qty: { ...d.qty, value: 0 } };
			const p = products.get(d.productId);
			const qty = p ? sizeDirect(p, amount) : null;
			return qty ? { ...d, qty } : d;
		});
		const need: Need = {
			...before,
			amount: { ...before.amount, value: amount.value },
			label: before.label.replace(
				`${before.amount.value} ${before.amount.unit}`,
				`${amount.value} ${amount.unit}`
			),
			provenance: { source: 'user', note: `${ctx.actor.kind} via ${ctx.via}: amount amended` }
		};
		return ok({
			plan,
			kitchen,
			drafts,
			need,
			changed: mine.map((d) => d.id),
			summary: `${before.label}: ${before.amount.value} → ${amount.value} ${amount.unit}`
		});
	}
	if (input.needId && input.patch.gramsPerGuest !== undefined && plan.source) {
		const before = plan.needs.find((n) => n.id === input.needId);
		if (!before) return err('NOT_FOUND', `need ${input.needId}`);
		if (plan.lines.some((l) => l.needId === input.needId && l.state === 'committed'))
			return err('STALE_VERSION', 'a line of this need is already committed');
		const proposal = await reviewedProposal(ports, ctx, {
			id: plan.source.proposalId,
			revision: plan.source.revision
		});
		if (!proposal.ok) return proposal;
		const overrides = { ...menuOverrides(plan.needs), [input.needId]: input.patch.gramsPerGuest };
		const item = menuDemand(proposal.value, overrides).find((i) => i.need.id === input.needId);
		if (!item) return err('NOT_FOUND', `need ${input.needId} in menu ${plan.source.proposalId}`);
		const ids = new Set(drafts.filter((d) => d.needId === input.needId).map((d) => d.productId));
		if (item.productId) ids.add(item.productId);
		const products = await ports.catalog.get([...ids]);
		const fresh = menuLine(plan.id, item, products);
		// Every open line of this need follows the new amount: the bought product and any substitute, sized alike.
		drafts = drafts.map((d) => {
			if (d.needId !== input.needId) return d;
			if (d.id === fresh.draft?.id) return { ...d, qty: fresh.draft.qty };
			const p = products.get(d.productId);
			const qty = p ? sizeDirect(p, fresh.need.amount) : null;
			return qty ? { ...d, qty } : d;
		});
		const unit = proposal.value.dishes
			.flatMap((x) => x.ingredients)
			.find((g) => g.id === before.source?.ingredientId)?.unit;
		return ok({
			plan,
			kitchen,
			drafts,
			need: fresh.need,
			changed: drafts.filter((d) => d.needId === input.needId).map((d) => d.id),
			summary: `${before.label}: ${before.dish?.gServed ?? '?'} → ${input.patch.gramsPerGuest} ${unit ?? 'g'}/guest`
		});
	}
	if (input.needId && input.patch.gramsPerGuest !== undefined) {
		const seed = plan.eventId ? ports.events?.[plan.eventId] : undefined;
		if (!seed) return err('INVALID_INPUT', 'this plan has no event to recompute');
		const before = plan.needs.find((n) => n.id === input.needId);
		if (!before) return err('NOT_FOUND', `need ${input.needId}`);
		if (plan.lines.some((l) => l.needId === input.needId && l.state === 'committed'))
			return err('STALE_VERSION', 'a line of this need is already committed');
		const overrides = { ...overridesOf(plan), [input.needId]: input.patch.gramsPerGuest };
		const next = demandLines(plan.id, seed, overrides);
		const need = next.needs.find((n) => n.id === input.needId);
		// R7-04: the dish's dependency closure. A cooked dish's ingredients share one amount (rice porridge: rice and
		// milk per kg cooked), so every need whose amount the recomputation moved follows, with its lines.
		const dependents = next.needs.filter((n) => {
			if (n.id === input.needId) return false;
			const was = plan.needs.find((x) => x.id === n.id);
			return was !== undefined && Math.abs(was.amount.value - n.amount.value) > 1e-9;
		});
		if (
			dependents.some((n) => plan.lines.some((l) => l.needId === n.id && l.state === 'committed'))
		)
			return err('STALE_VERSION', 'a line of a dependent need is already committed');
		const moved = new Set([input.needId, ...dependents.map((n) => n.id)]);
		const fresh = new Map(next.drafts.map((d) => [d.id, d]));
		drafts = drafts.map((d) => (d.needId && moved.has(d.needId) ? (fresh.get(d.id) ?? d) : d));
		// Replacements serving this dish follow the new need: a product substitute by the same yield/pack rules
		// as when it was ranked, make-in-house ingredients by their amount per kg of dish.
		const subs = drafts.filter((d) => d.needId === input.needId && d.substituteFor);
		if (need && need.amount.unit === 'kg' && subs.length) {
			const servedKg = need.amount.value * (need.dish?.yield ?? 1);
			const products = await ports.catalog.get(subs.map((d) => d.productId));
			const recipe = rescueFor(seed, subs[0].substituteFor!)?.chosen;
			drafts = drafts.map((d) => {
				if (!subs.includes(d)) return d;
				if (d.id.includes('-mih-')) {
					const g = recipe?.ingredients?.find(
						(x: { productId: string }) => x.productId === d.productId
					);
					return g ? { ...d, qty: makeInHouseQty(g, need.amount.value) } : d;
				}
				const p = products.get(d.productId);
				const line = plan.lines.find((l) => l.id === d.id);
				const entry = seedEntryFor(seed, before.label, d.substituteFor!, d.productId);
				const qty = p && line ? sizeFor(p, entry, servedKg, line)?.qty : null;
				return qty ? { ...d, qty } : d;
			});
		}
		const dish = seed.dishes.find((x) => x.dish === before.label);
		return ok({
			plan,
			kitchen,
			drafts,
			need,
			dependents,
			changed: drafts.filter((d) => d.needId && moved.has(d.needId)).map((d) => d.id),
			summary: `${before.label}: g/guest ${dish?.gServed ?? '?'} → ${input.patch.gramsPerGuest}`
		});
	}
	if (input.lineId) {
		const line = plan.lines.find((l) => l.id === input.lineId);
		if (!line) return err('NOT_FOUND', `line ${input.lineId}`);
		if (line.state === 'committed') return err('STALE_VERSION', 'committed lines cannot be edited');
		const productId = input.patch.productId ?? line.productId;
		const product = (await ports.catalog.get([productId])).get(productId);
		if (!product) return err('NOT_FOUND', `product ${productId}`);
		const qty =
			input.patch.qty !== undefined ? toLot(input.patch.qty, product.salesUnit, product) : line.qty;
		return ok({
			plan,
			kitchen,
			drafts: drafts.map((d) =>
				d.id === line.id
					? {
							...d,
							productId,
							qty,
							// A quantity set by hand brings a superseded line back.
							...(qty.value > 0
								? { extraReasons: d.extraReasons?.filter((r) => r !== 'superseded') }
								: {})
						}
					: d
			),
			changed: [line.id],
			summary: `${line.productId} ${line.qty.value} ${line.qty.unit} → ${productId} ${qty.value} ${qty.unit}`
		});
	}
	return err('INVALID_INPUT', 'give needId + gramsPerGuest, or lineId + qty/productId');
}

export async function editLine(
	ports: ServicePorts,
	ctx: CallContext,
	input: ToolInput<'edit_line'>
): Promise<Result<ToolOutput<'edit_line'>>> {
	const prepared = await prepareEdit(ports, ctx, input);
	if (!prepared.ok) return prepared;
	const { plan, kitchen, drafts, need, dependents = [], changed, summary } = prepared.value;
	const pre = await prefetch(
		ports,
		drafts.map((d) => d.productId),
		plan.deliverBy
	);

	const r = await ports.store.transact<Plan>(ctx.workspaceId, async (tx, state) => {
		const now = state.plans[plan.id];
		if (!now || now.version !== plan.version) return conflict(`plan ${plan.id}`);
		const proposed = (d: DraftLine): Line => ({
			...d,
			state: 'proposed',
			reasons: [],
			offer: null,
			lineCents: null
		});
		const linesOf = (ids: string[]) =>
			ids.map((id) => ({ lineId: id, line: proposed(drafts.find((d) => d.id === id)!) }));
		const depIds = new Set(dependents.map((n) => n.id));
		const isDep = (id: string) => depIds.has(drafts.find((d) => d.id === id)?.needId ?? '');
		// One EditLine for the edited need, then one per dependent need, each with its own lines.
		const ops = [
			pending(ctx, {
				type: 'EditLine',
				planId: plan.id,
				baseVersion: plan.version,
				need,
				lines: linesOf(changed.filter((id) => !isDep(id))),
				summary
			}),
			...dependents.map((n, i) =>
				pending(ctx, {
					type: 'EditLine',
					planId: plan.id,
					baseVersion: plan.version + 1 + i,
					need: n,
					lines: linesOf(changed.filter((id) => drafts.find((d) => d.id === id)?.needId === n.id)),
					summary: `${n.label} follows: ${n.amount.value} ${n.amount.unit}`
				})
			)
		];
		const after = [...(need ? [need] : []), ...dependents];
		const edited: Plan = {
			...plan,
			version: plan.version + ops.length,
			state: 'draft',
			termsHash: null,
			needs: plan.needs.map((n) => after.find((x) => x.id === n.id) ?? n)
		};
		const q = await requote(ports, ctx, tx, state, edited, kitchen, drafts, pre);
		return { ops: [...ops, ...q.ops], value: q.plan };
	});
	return r.ok ? ok({ plan: r.value.value }) : r;
}

export async function explainLine(
	ports: ServicePorts,
	ctx: CallContext,
	input: ToolInput<'explain_line'>
): Promise<Result<ToolOutput<'explain_line'>>> {
	const state = await ports.store.load(ctx.workspaceId, ctx.runId);
	const plan = state.plans[input.planId];
	const line = plan?.lines.find((l) => l.id === input.lineId);
	if (!plan || !line) return err('NOT_FOUND', `line ${input.lineId}`);
	const steps: { text: string; source: string }[] = [];
	const need = plan.needs.find((n) => n.id === line.needId);
	const seed = plan.eventId ? ports.events?.[plan.eventId] : undefined;
	if (need) {
		const dish = seed?.dishes.find((d) => d.dish === need.label);
		const g = overridesOf(plan)[need.id] ?? dish?.gServed;
		steps.push({
			text: `dish: ${need.label}`,
			source: need.provenance.ref ?? need.provenance.source
		});
		if (g !== undefined && seed) {
			steps.push({
				text: `${g} g/guest served`,
				source: need.provenance.note ? 'user' : 'team_estimate'
			});
			steps.push({ text: `× ${seed.guests.estimate} guests`, source: 'seed' });
			if (dish?.yield && dish.yield !== 1)
				steps.push({ text: `÷ yield ${dish.yield}`, source: 'team_estimate' });
		} else if (need.source && need.dish) {
			// A menu need: the chef-reviewed amount per cover (an estimate unless the chef changed it) × guests ÷ yield.
			steps.push({ text: need.dish.formula, source: need.provenance.source });
		}
		steps.push({
			text: `need ${need.amount.value} ${need.amount.unit}${need.amount.basis ? ` (${need.amount.basis})` : ''}`,
			source: 'computed'
		});
	} else {
		const product = (await ports.catalog.get([line.productId])).get(line.productId);
		steps.push({
			text: `requested: ${line.qty.value} ${line.qty.unit} of ${line.productId}`,
			source: line.provenance.note ?? line.provenance.source
		});
		if (product) steps.push({ text: `catalogue: ${product.nameFi}`, source: 'valio_static' });
	}
	steps.push({
		text: line.qty.rounding ?? `${line.qty.value} ${line.qty.unit}`,
		source: 'catalogue lot/pack'
	});
	const price = line.offer?.price;
	if (price && line.lineCents !== null)
		steps.push({
			text: `€${(price.unitCents / 100).toFixed(2)} per ${line.qty.unit} → €${(line.lineCents / 100).toFixed(2)}`,
			source: `${price.provenance.source}${price.provenance.at ? ` at ${price.provenance.at}` : ''}`
		});
	const a = line.offer?.availability;
	if (a)
		steps.push({
			text: `availability: ${AVAILABILITY_WORDING[a.kind]}${a.amount !== null ? ` (${a.amount})` : a.kind === 'known' ? ' (unlimited)' : ''}${a.logisticModel ? `, ${a.logisticModel}` : ''}`,
			source: a.provenance.note ?? a.provenance.source
		});
	steps.push({
		text: `${line.state}${line.tier ? ` (${line.tier})` : ''}${line.reasons.length ? `: ${line.reasons.join(', ')}` : ''}`,
		source: 'mandate'
	});
	return ok({ steps });
}
