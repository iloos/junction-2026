/**
 * The Orders tab's rows: each plan's four stages (core/services/stages.ts) as plain sentences and amounts. Ids,
 * versions and terms hashes ride along for the System layer only.
 */
import type { ActorKind } from '$lib/core/contracts';
import type { OrderStages, Origin } from '$lib/core/services/stages';
import { decisionsDue, type Decision } from '$lib/ui/decisions';
import { day } from '$lib/ui/format';
import { salesUnitWords } from '$lib/ui/request/words';
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
		changes: { seq: number; at: string; actor: ActorKind | 'valio'; text: string }[];
		unchanged: number;
	};
	signed: { seq: number; at: string; text: string; state: string; terms: string }[];
	/** The open decisions, exactly as the kitchen shows them (DecisionCard). */
	decisions: Decision[];
	/** What an approve binds to: the pending approval, its plan version and terms, and the run. */
	approval: { id: string; planVersion: number; termsHash: string; runId: string } | null;
	/** When the decisions are due (decisionsDue), for cards without their own time. */
	due: string;
	/** Product names by id, for the cards. */
	names: Record<string, string>;
	ordered: {
		orderId: string;
		at: string;
		totalCents: number;
		terms: string;
		lines: {
			name: string;
			qty: string;
			cents: number;
			status: 'confirmed' | 'awaiting' | 'ordered';
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
	const guests = s.plan.needs.find((n) => n.dish)?.dish?.guests;
	return needs.length
		? `${plural(needs.length, 'dish', 'dishes')}${guests ? ` for ${guests} guests` : ''}`
		: 'An order still being drafted';
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

export function orderRow(s: OrderStages, decisions: Decision[]): OrderRow {
	const st = statusOf(s, decisions.length);
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
				actor: c.kind === 'out' || c.kind === 'undeliverable' ? ('valio' as const) : c.actor,
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
		due: decisionsDue(s.plan, s.pending),
		names: Object.fromEntries(s.plan.lines.map((l) => [l.productId, l.productName ?? l.productId])),
		ordered: s.ordered.map((o) => ({
			orderId: o.orderId,
			at: o.at,
			totalCents: o.totalCents,
			terms: `plan v${o.planVersion}`,
			lines: o.lines.map((l) => ({
				name: l.name,
				qty: salesUnitWords(l.qty.value, l.qty.unit),
				cents: l.lineCents,
				status: l.status
			}))
		}))
	};
}
