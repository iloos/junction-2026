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
	planEventDemand,
	rescueFor,
	seedEntryFor,
	seedNeedQty,
	sizeFor,
	type EventSeed
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
		const formula = `${g} g × ${guests}${y !== 1 ? ` ÷ ${y.toFixed(2)}` : ''} = ${n.amount.value.toFixed(1)} ${n.amount.unit}`;
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
		expectedQty: expectedFor(ports, plan)
	});
	return quoteOps(ctx, ports, plan, kitchen, t, pre.offers);
}

/** The seed's per-line need for an event plan (none for a direct order). */
export function expectedFor(ports: ServicePorts, plan: Plan) {
	const seed = plan.eventId ? ports.events?.[plan.eventId] : undefined;
	return seed ? seedNeedQty(plan.id, seed) : undefined;
}

const conflict = (what: string) => ({
	error: err('STALE_VERSION', `${what} changed while this call was prepared; reload and retry`)
		.error
});

export async function planEvent(
	ports: ServicePorts,
	ctx: CallContext,
	input: ToolInput<'plan_event'>
): Promise<Result<ToolOutput<'plan_event'>>> {
	if (input.eventId === undefined)
		return err(
			'INVALID_INPUT',
			'planning from a brief is not available yet; give a seeded eventId'
		);
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
			needs,
			lines: [],
			totalCents: null,
			termsHash: null,
			createdBy: ctx.actor
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
		const fresh = new Map(next.drafts.map((d) => [d.id, d]));
		drafts = drafts.map((d) => (d.needId === input.needId ? (fresh.get(d.id) ?? d) : d));
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
			changed: drafts.filter((d) => d.needId === input.needId).map((d) => d.id),
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
			drafts: drafts.map((d) => (d.id === line.id ? { ...d, productId, qty } : d)),
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
	const { plan, kitchen, drafts, need, changed, summary } = prepared.value;
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
		const edit = pending(ctx, {
			type: 'EditLine',
			planId: plan.id,
			baseVersion: plan.version,
			need,
			lines: changed.map((id) => ({
				lineId: id,
				line: proposed(drafts.find((d) => d.id === id)!)
			})),
			summary
		});
		const edited: Plan = {
			...plan,
			version: plan.version + 1,
			state: 'draft',
			termsHash: null,
			needs: need ? plan.needs.map((n) => (n.id === need.id ? need : n)) : plan.needs
		};
		const q = await requote(ports, ctx, tx, state, edited, kitchen, drafts, pre);
		return { ops: [edit, ...q.ops], value: q.plan };
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
