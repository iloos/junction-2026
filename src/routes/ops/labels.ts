import type { ActorKind, Line, OpEnvelope, SimEvent, Tier } from '$lib/core/contracts';

export const euro = (cents: number | null | undefined) =>
	cents == null
		? '–'
		: (cents / 100).toLocaleString('en-IE', { style: 'currency', currency: 'EUR' });

export const TIER: Record<Tier, { word: string; hint: string }> = {
	act: { word: 'Acts alone', hint: 'Inside the mandate' },
	propose: { word: 'Chef confirms', hint: 'One tap from the chef' },
	sign_off: { word: 'Needs sign-off', hint: 'A named approver must sign' }
};

const REASON: Record<string, string> = {
	new_sku: 'New product for this kitchen',
	substitute_breaks_preference: 'Substitute breaks a preference',
	origin_required: 'Origin rule not met',
	off_tender_list: 'Not on the tender list',
	over_hard_limit: 'Over the hard limit',
	qty_implausible: 'Check the quantity',
	allergen_unknown: 'Allergens not declared',
	allergen_change: 'Allergen change',
	low_reliability: 'Unreliable delivery record',
	external_agent_needs_approval: 'Ordered by an outside agent',
	cutoff_passed: 'Cut-off has passed',
	unknown: 'Stock quantity unknown',
	out: 'Out of stock',
	undeliverable: 'Not deliverable',
	blocked: 'Blocked by Valio',
	BELOW_LOT: 'Below one lot',
	INSUFFICIENT_STOCK: 'Not enough stock',
	CAP_EXCEEDED: 'Over a spending cap',
	UNKNOWN_REQUIRED: 'Missing a required value',
	TERMS_CHANGED: 'Terms changed',
	STALE_VERSION: 'Plan changed since',
	PROVIDER_UNAVAILABLE: 'Valio API unavailable',
	FORBIDDEN: 'Not allowed'
};
const CAP_SUB: Record<string, string> = {
	line: 'Over the line cap',
	order: 'Over the order cap',
	weekly: 'Over the weekly cap'
};

export function reasonText(r: string): string {
	if (REASON[r]) return REASON[r];
	const [code, sub] = r.split('.');
	if (code === 'CAP_EXCEEDED' && sub && CAP_SUB[sub]) return CAP_SUB[sub];
	return REASON[code] ?? r.replaceAll('_', ' ').toLowerCase();
}

export const ACTOR: Record<ActorKind, string> = {
	chef: 'Chef',
	kitchen_agent: 'Kitchen agent',
	external_agent: 'Outside agent',
	approver: 'Approver',
	system: 'System',
	job: 'Background job'
};

export type Names = Record<string, string>;
/** A product's name, or `Product <id>` when neither the seeds nor the simulated run name it. */
export const productName = (names: Names, id: string) => names[id] ?? `Product ${id}`;
const name = productName;

export function lineIsHeld(l: Line): boolean {
	return l.state === 'held' || l.state === 'unorderable';
}

/** One plain sentence per op for the log. */
export function opSummary(env: OpEnvelope, names: Names): string {
	const op = env.op;
	switch (op.type) {
		case 'CreatePlan':
			return `Drafted an order with ${op.plan.lines.length} lines for delivery ${op.plan.deliverBy}`;
		case 'EditLine':
			return op.summary;
		case 'RecordOffer': {
			const held = op.lines.filter(lineIsHeld).length;
			return `Quoted ${euro(op.totalCents)} on live terms${held ? `, ${held} held` : ', all within the mandate'}`;
		}
		case 'ProposeSubstitute': {
			const forLine = op.lines[0]?.substituteFor;
			const sub = op.lines[0]?.productId;
			return sub
				? `Proposed ${name(names, sub)}${forLine ? ` instead of ${name(names, forLine)}` : ''}`
				: 'Found no substitute that qualifies';
		}
		case 'RecordApproval': {
			const a = op.approval;
			const n = `${a.lineIds.length} line${a.lineIds.length === 1 ? '' : 's'}`;
			if (a.state === 'pending')
				return a.tier === 'sign_off'
					? `Asked a named approver to sign off ${n}`
					: `Asked the chef to confirm ${n}`;
			if (a.state === 'granted')
				return `${a.decidedBy ? ACTOR[a.decidedBy.kind] : 'Someone'} approved ${n}`;
			return `Approval ${a.state}${a.reason ? `: ${a.reason}` : ''}`;
		}
		case 'CommitOrder': {
			const o = op.outcome;
			if (o.result === 'failed') return `Commit refused (${o.error.code}): ${o.error.message}`;
			const confirmed = o.receipt.confirmed.length;
			return `Committed ${euro(o.order.totalCents)}, supplier confirmed ${confirmed} of ${o.order.lines.length} lines`;
		}
		case 'RecordAnomaly':
			return op.anomaly.message;
		case 'RecordEnrichment':
			return `Added ${op.field} for ${name(names, op.productId)} (${op.provenance.source})`;
	}
}

export function opPlanId(env: OpEnvelope): string | undefined {
	const op = env.op;
	switch (op.type) {
		case 'CreatePlan':
			return op.plan.id;
		case 'RecordApproval':
			return op.approval.planId;
		case 'CommitOrder':
			return op.outcome.result === 'committed' ? op.outcome.order.planId : op.outcome.planId;
		case 'RecordAnomaly':
			return op.anomaly.planId;
		case 'RecordEnrichment':
			return undefined;
		default:
			return op.planId;
	}
}

export const SIM_KIND: Record<SimEvent['kind'], string> = {
	'atp.changed': 'Stock changed',
	'contention.detected': 'Contention',
	'cutoff.closed': 'Cut-off',
	'allocation.decided': 'Allocation',
	'supply.arrived': 'Supply arrived'
};
