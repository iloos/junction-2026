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
	type PendingOp,
	type Plan,
	type Result,
	type ToolInput,
	type ToolOutput
} from '../contracts';
import { sha256Hex } from '../hash';
import { planEventDemand, type EventSeed } from '../demand';
import { isoWeek, tierLines, type DraftLine } from '../mandate/tier';
import type { CallContext, Ports, Tx } from '../ports';
import type { WorkspaceState } from '../state';
import { quoteOps, toLot } from './orders';

/** Ports plus the event seeds the server loaded (core reads no files). */
export type ServicePorts = Ports & { events?: Record<string, EventSeed> };

const pending = (ctx: CallContext, op: PendingOp['op']): PendingOp => ({
	workspaceId: ctx.workspaceId,
	runId: ctx.runId,
	actor: ctx.actor,
	via: ctx.via,
	op
});

/** The delivery for an event lands the day before it. */
export function deliverByFor(eventDate: string): string {
	const d = new Date(`${eventDate}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() - 1);
	return d.toISOString().slice(0, 10);
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
	const needs: Need[] = d.needs.map((n) =>
		overrides[n.id] !== undefined
			? { ...n, provenance: { ...n.provenance, note: `gServed=${overrides[n.id]}` } }
			: n
	);
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

async function kitchenOf(ports: Ports, ctx: CallContext, id: string): Promise<Kitchen | null> {
	return (await ports.store.kitchens(ctx.workspaceId)).find((k) => k.id === id) ?? null;
}

const orderedBefore = (state: WorkspaceState, kitchenId: string) =>
	new Set(
		Object.values(state.orders)
			.filter((o) => o.kitchenId === kitchenId)
			.flatMap((o) => o.lines.map((l) => l.productId))
	);

/** Tiers the open drafts (committed lines stay) and returns the quote ops for the plan. */
async function requote(
	ports: Ports,
	ctx: CallContext,
	tx: Tx,
	state: WorkspaceState,
	plan: Plan,
	kitchen: Kitchen,
	drafts: DraftLine[]
) {
	const ids = [...new Set(drafts.map((d) => d.productId))];
	const [{ offers }, products] = await Promise.all([
		ports.catalog.offers(ids, plan.deliverBy),
		ports.catalog.get(ids)
	]);
	const spent = await ports.store.lockBudget(tx, {
		workspaceId: ctx.workspaceId,
		kitchenId: kitchen.id,
		week: isoWeek(plan.deliverBy)
	});
	const t = tierLines({
		kitchen,
		lines: drafts,
		offers: new Map(offers.map((o) => [o.productId, o])),
		products,
		weekSpentCents: spent,
		actor: ctx.actor.kind,
		createdBy: plan.createdBy.kind,
		orderedBefore: orderedBefore(state, kitchen.id),
		committed: plan.lines.filter((l) => l.state === 'committed')
	});
	return quoteOps(ctx, ports, plan, kitchen, t, offers);
}

export async function planEvent(
	ports: ServicePorts,
	ctx: CallContext,
	input: ToolInput<'plan_event'>
): Promise<Result<ToolOutput<'plan_event'>>> {
	const seed = ports.events?.[input.eventId];
	if (!seed) return err('NOT_FOUND', `event ${input.eventId}`);
	const kitchen = await kitchenOf(ports, ctx, input.kitchenId);
	if (!kitchen) return err('NOT_FOUND', `kitchen ${input.kitchenId}`);
	const planId = `pl-${ctx.runId}-${(await sha256Hex(`event|${kitchen.id}|${input.eventId}`)).slice(0, 12)}`;
	const r = await ports.store.transact<Plan>(ctx.workspaceId, async (tx, state) => {
		const existing = state.plans[planId];
		if (existing) return { ops: [], value: existing }; // one plan per (kitchen, event): planning again is a read
		const { needs, drafts } = demandLines(planId, seed, {});
		const plan0: Plan = {
			workspaceId: ctx.workspaceId,
			runId: ctx.runId,
			id: planId,
			kitchenId: kitchen.id,
			version: 0,
			state: 'draft',
			deliverBy: deliverByFor(seed.date),
			eventId: input.eventId,
			needs,
			lines: [],
			totalCents: null,
			termsHash: null,
			createdBy: ctx.actor
		};
		const q = await requote(ports, ctx, tx, state, plan0, kitchen, drafts);
		return { ops: [pending(ctx, { type: 'CreatePlan', plan: plan0 }), ...q.ops], value: q.plan };
	});
	return r.ok ? ok({ plan: r.value.value }) : r;
}

export async function editLine(
	ports: ServicePorts,
	ctx: CallContext,
	input: ToolInput<'edit_line'>
): Promise<Result<ToolOutput<'edit_line'>>> {
	// Kitchens are read before the transaction: no query may run outside it while it holds the lock.
	const kitchens = await ports.store.kitchens(ctx.workspaceId);
	const r = await ports.store.transact<Plan>(ctx.workspaceId, async (tx, state) => {
		const plan = state.plans[input.planId];
		if (!plan) return { error: err('NOT_FOUND', `plan ${input.planId}`).error };
		if (plan.version !== input.version)
			return {
				error: err('STALE_VERSION', `plan is at v${plan.version}, not v${input.version}`).error
			};
		const kitchen = kitchens.find((k) => k.id === plan.kitchenId);
		if (!kitchen) return { error: err('NOT_FOUND', `kitchen ${plan.kitchenId}`).error };
		const toDraft = (l: Line): DraftLine => ({
			id: l.id,
			needId: l.needId,
			productId: l.productId,
			qty: l.qty,
			provenance: l.provenance,
			substituteFor: l.substituteFor
		});
		let drafts = plan.lines.filter((l) => l.state !== 'committed').map(toDraft);
		let need: Need | undefined;
		let summary: string;
		let changed: string[];

		if (input.needId && input.patch.gramsPerGuest !== undefined) {
			const seed = plan.eventId ? ports.events?.[plan.eventId] : undefined;
			if (!seed)
				return { error: err('INVALID_INPUT', 'this plan has no event to recompute').error };
			const before = plan.needs.find((n) => n.id === input.needId);
			if (!before) return { error: err('NOT_FOUND', `need ${input.needId}`).error };
			const overrides = { ...overridesOf(plan), [input.needId]: input.patch.gramsPerGuest };
			const next = demandLines(plan.id, seed, overrides);
			need = next.needs.find((n) => n.id === input.needId);
			const fresh = new Map(next.drafts.map((d) => [d.id, d]));
			if (plan.lines.some((l) => l.needId === input.needId && l.state === 'committed'))
				return { error: err('STALE_VERSION', 'a line of this need is already committed').error };
			drafts = drafts.map((d) => (d.needId === input.needId ? (fresh.get(d.id) ?? d) : d));
			changed = drafts.filter((d) => d.needId === input.needId).map((d) => d.id);
			const dish = seed.dishes.find((x) => x.dish === before.label);
			summary = `${before.label}: g/guest ${dish?.gServed ?? '?'} → ${input.patch.gramsPerGuest}`;
		} else if (input.lineId) {
			const line = plan.lines.find((l) => l.id === input.lineId);
			if (!line) return { error: err('NOT_FOUND', `line ${input.lineId}`).error };
			if (line.state === 'committed')
				return { error: err('STALE_VERSION', 'committed lines cannot be edited').error };
			const productId = input.patch.productId ?? line.productId;
			const product = (await ports.catalog.get([productId])).get(productId);
			if (!product) return { error: err('NOT_FOUND', `product ${productId}`).error };
			const qty =
				input.patch.qty !== undefined
					? toLot(input.patch.qty, product.salesUnit, product)
					: line.qty;
			drafts = drafts.map((d) => (d.id === line.id ? { ...d, productId, qty } : d));
			changed = [line.id];
			summary = `${line.productId} ${line.qty.value} ${line.qty.unit} → ${productId} ${qty.value} ${qty.unit}`;
		} else
			return {
				error: err('INVALID_INPUT', 'give needId + gramsPerGuest, or lineId + qty/productId').error
			};

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
			needs: need ? plan.needs.map((n) => (n.id === need!.id ? need! : n)) : plan.needs
		};
		const q = await requote(ports, ctx, tx, state, edited, kitchen, drafts);
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
			text: `availability: ${a.kind}${a.amount !== null ? ` (${a.amount})` : a.kind === 'known' ? ' (unlimited)' : ''}${a.logisticModel ? `, ${a.logisticModel}` : ''}`,
			source: a.provenance.note ?? a.provenance.source
		});
	steps.push({
		text: `${line.state}${line.tier ? ` (${line.tier})` : ''}${line.reasons.length ? `: ${line.reasons.join(', ')}` : ''}`,
		source: 'mandate'
	});
	return ok({ steps });
}
