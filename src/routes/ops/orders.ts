/**
 * The Orders tab's rows: each plan's four stages (core/services/stages.ts) as plain sentences and amounts. Ids,
 * versions and terms hashes ride along for the System layer only.
 */
import type { ActorKind } from '$lib/core/contracts';
import type { OrderStages, Origin } from '$lib/core/services/stages';
import type { Decision } from '$lib/ui/decisions';
import { SCENARIO } from '$lib/core/scenario';
import { day } from '$lib/ui/format';
import { salesUnitWords } from '$lib/ui/request/words';
import { dueOf } from '$lib/core/mandate/due';
import { dishName } from './problems';

export interface OrderRow {
	planId: string;
	kitchenId: string;
	title: string;
	origin: Origin;
	deliverBy: string;
	/** "4 lines ordered · 2 decisions left" and the like. */
	status: string;
	done: boolean;
	orderedCents: number;
	waitingCents: number;
	version: number;
	asked: {
		at: string;
		actor: string;
		needs: { id: string; label: string; amount: string; basis: string; later: boolean }[];
	};
	proposed: {
		/** `valio` for what Valio's answers changed (outages), else who changed it. */
		changes: { seq: number; at: string; actor: ActorKind | 'valio' | 'rules'; text: string }[];
		unchanged: number;
	};
	signed: { seq: number; at: string; text: string; state: string; terms: string }[];
	/** The open decisions, exactly as the kitchen shows them (DecisionCard). */
	decisions: Decision[];
	/** What an approve binds to: the pending approval, its plan version and terms, and the run. */
	approval: { id: string; planVersion: number; termsHash: string; runId: string } | null;
	/** When the decisions are due (dueOf, else the scenario cut-off), for cards without their own time. */
	due: string;
	/** Product names by id, for the cards. */
	names: Record<string, string>;
	/** Needs nothing can be bought for (no product, or no line serves them), by name; and how many needs in all. */
	gaps: string[];
	needCount: number;
	ordered: {
		orderId: string;
		at: string;
		totalCents: number;
		terms: string;
		/** The submission's trail, one sentence each: who asked, what changed, who signed, who placed it. */
		trail: string[];
		lines: {
			name: string;
			qty: string;
			cents: number;
			status: 'confirmed' | 'awaiting' | 'ordered';
			/** "within the mandate" or "signed by the chef". */
			allowedBy: string;
		}[];
	}[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const WHO: Record<ActorKind, string> = {
	chef: 'the chef',
	approver: 'the named approver',
	kitchen_agent: 'the kitchen agent',
	external_agent: 'an outside agent',
	system: 'the system',
	job: 'a monitor job'
};

const amountText = (m: { value: number; unit: string }) =>
	m.unit === 'kg' || m.unit === 'l'
		? `${Math.round(m.value * 10) / 10} ${m.unit}`
		: `${Math.round(m.value)} ${m.unit}`;

/** A plan's name from what it asks for: a few direct items by name, otherwise its dishes. */
export function planTitle(s: OrderStages): string {
	const needs = s.asked.needs;
	if (!needs.length && s.asked.lines.length)
		return s.asked.lines.length <= 2
			? s.asked.lines
					.map((l) => `${salesUnitWords(l.qty.value, l.qty.unit)} ${l.name}`)
					.join(' and ')
			: `${plural(s.asked.lines.length, 'product')} ordered by line`;
	const direct = s.plan.needs.every((n) => n.kind === 'direct' || (!n.dish && n.kind !== 'dish'));
	if (needs.length && needs.length <= 2 && direct)
		return needs
			.map((n) => `${amountText(n.amount)} ${dishName(n.label).toLowerCase()}`)
			.join(' and ');
	if (!needs.length) return 'An order still being drafted';
	const guests = s.plan.needs.find((n) => n.dish)?.dish?.guests;
	const forGuests = guests ? ` for ${guests} guests` : '';
	// Menu needs are ingredients; the dish count is the distinct dishes they come from.
	const dishes = new Set(s.plan.needs.flatMap((n) => (n.source ? [n.source.dishId] : []))).size;
	return dishes
		? `${plural(dishes, 'dish', 'dishes')}${forGuests} · ${plural(needs.length, 'ingredient')}`
		: `${plural(needs.length, 'ingredient')}${forGuests}`;
}

function statusOf(s: OrderStages, decisions: number): { status: string; done: boolean } {
	const ordered = s.ordered.reduce((n, o) => n + o.lines.length, 0);
	const awaiting = s.ordered.reduce(
		(n, o) => n + o.lines.filter((l) => l.status === 'awaiting').length,
		0
	);
	const parts: string[] = [];
	if (ordered) parts.push(`${plural(ordered, 'line')} ordered`);
	if (awaiting) parts.push(`${awaiting} awaiting the supplier`);
	if (decisions) parts.push(`${plural(decisions, 'decision')} left`);
	if (!parts.length)
		parts.push(s.held.lines ? `${plural(s.held.lines, 'line')} held` : 'Nothing ordered yet');
	return { status: parts.join(' · '), done: !!ordered && !decisions && !s.held.lines };
}

function signedText(a: OrderStages['signed'][number]): string {
	const lines = plural(a.lines, 'line');
	const who = a.tier === 'sign_off' ? 'a named approver' : 'the chef';
	switch (a.state) {
		case 'pending':
			return `Waiting for ${who} to sign ${lines} (asked by ${WHO[a.requestedBy]}).`;
		case 'granted':
			return `${(a.decidedBy ? WHO[a.decidedBy] : 'someone').replace(/^./, (c) => c.toUpperCase())} signed ${lines} on these exact terms.`;
		case 'denied':
			return `${(a.decidedBy ? WHO[a.decidedBy] : 'someone').replace(/^./, (c) => c.toUpperCase())} said no to ${lines}${a.reason ? `: ${a.reason}` : ''}.`;
		case 'invalidated':
			return `The request to sign ${lines} lapsed: the plan changed after it was asked.`;
		case 'expired':
			return `The request to sign ${lines} expired before anyone answered.`;
		default:
			return `The request for ${lines} is ${a.state}.`;
	}
}

/** Needs nothing can be bought for: an `unresolved` gap, or no line serves them. */
export function gapsOf(plan: OrderStages['plan']): string[] {
	const served = new Set(plan.lines.filter((l) => l.qty.value > 0).map((l) => l.needId));
	return plan.needs.filter((n) => n.unresolved || !served.has(n.id)).map((n) => dishName(n.label));
}

/** "22 of 30 needs ordered; 8 had no product: x, y, z, …". */
export function gapSentence(gaps: readonly string[], needs: number): string {
	const names = gaps.slice(0, 4).join(', ') + (gaps.length > 4 ? ', …' : '');
	return `${needs - gaps.length} of ${needs} needs covered; ${gaps.length} had no product: ${names}.`;
}

export function orderRow(s: OrderStages, decisions: Decision[]): OrderRow {
	const st = statusOf(s, decisions.length);
	const gaps = gapsOf(s.plan);
	const creator = s.createdBy;
	return {
		planId: s.planId,
		kitchenId: s.kitchenId,
		title: planTitle(s),
		origin: s.origin,
		deliverBy: day(s.deliverBy),
		...st,
		orderedCents: s.orderedCents,
		waitingCents: s.held.cents,
		version: s.version,
		asked: {
			at: s.asked.at,
			actor: WHO[creator],
			needs: s.asked.needs.length
				? s.asked.needs.map((n) => ({
						id: n.needId,
						label: dishName(n.label),
						amount: amountText(n.amount),
						basis: n.basis,
						later: !!n.addedLater
					}))
				: s.asked.lines.map((l, i) => ({
						id: `line-${i}`,
						label: l.name,
						amount: salesUnitWords(l.qty.value, l.qty.unit),
						basis: 'Asked for by product and amount',
						later: false
					}))
		},
		proposed: {
			changes: s.proposed.changes.map((c) => ({
				seq: c.seq,
				at: c.at,
				actor: c.by === 'valio' ? ('valio' as const) : c.by ? ('rules' as const) : c.actor,
				text: c.text
			})),
			unchanged: s.proposed.unchanged
		},
		signed: s.signed.map((a) => ({
			seq: a.seq,
			at: a.at,
			text: signedText(a),
			state: a.state,
			terms: `plan v${a.planVersion} · terms ${a.termsHash.slice(0, 8)}`
		})),
		decisions,
		approval: s.pending
			? {
					id: s.pending.id,
					planVersion: s.pending.planVersion,
					termsHash: s.pending.termsHash,
					runId: s.plan.runId
				}
			: null,
		due: dueOf(s.plan, s.pending) ?? SCENARIO.cutoff,
		names: Object.fromEntries(s.plan.lines.map((l) => [l.productId, l.productName ?? l.productId])),
		gaps,
		needCount: s.plan.needs.length,
		ordered: s.ordered.map((o) => ({
			orderId: o.orderId,
			at: o.at,
			totalCents: o.totalCents,
			terms: `plan v${o.planVersion} · terms ${o.termsHash.slice(0, 8)}`,
			trail: trailOf(s, o),
			lines: o.lines.map((l) => ({
				name: l.name,
				qty: salesUnitWords(l.qty.value, l.qty.unit),
				cents: l.lineCents,
				status: l.status,
				allowedBy:
					l.authority.kind === 'mandate'
						? 'within the mandate'
						: `signed by ${l.authority.by ? WHO[l.authority.by] : 'a person'}`
			}))
		}))
	};
}

/** The order as the kitchen confirmed it: who asked, what the agents changed, who signed what, who placed it. */
function trailOf(s: OrderStages, o: OrderStages['ordered'][number]): string[] {
	const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
	const out = [`Asked by ${WHO[s.createdBy]}.`];
	const changes = s.proposed.changes.filter((c) => c.seq < o.seq);
	const gaps = gapsOf(s.plan);
	out.push(
		changes.length
			? `${plural(changes.length, 'change')} on the way, each with its reason in Proposed.`
			: gaps.length
				? 'No line was changed on the way.'
				: 'Ordered as asked, with no changes.'
	);
	if (gaps.length) out.push(gapSentence(gaps, s.plan.needs.length));
	for (const a of s.signed)
		if (a.state === 'granted' && a.seq <= o.seq)
			out.push(
				`${cap(a.decidedBy ? WHO[a.decidedBy] : 'someone')} signed ${plural(a.lines, 'line')} on the terms of plan version ${a.planVersion}.`
			);
	const mandate = o.lines.filter((l) => l.authority.kind === 'mandate').length;
	if (mandate)
		out.push(`${plural(mandate, 'line')} needed no signature: within the kitchen's mandate.`);
	out.push(`Placed by ${WHO[o.committedBy]} at plan version ${o.planVersion}.`);
	const awaiting = o.lines.filter((l) => l.status === 'awaiting').length;
	if (awaiting) out.push(`${plural(awaiting, 'line')} still awaiting the supplier's confirmation.`);
	return out;
}
