import type {
	ActorKind,
	Approval,
	Line,
	OpEnvelope,
	Plan,
	SimEvent,
	Tier
} from '$lib/core/contracts';
import { reasonShort } from '$lib/ui/reasons';
import { day } from '$lib/ui/format';
import { decisionsOf } from '$lib/ui/decisions';

export const euro = (cents: number | null | undefined) =>
	cents == null
		? '–'
		: (cents / 100).toLocaleString('en-IE', { style: 'currency', currency: 'EUR' });

export const TIER: Record<Tier, { word: string; hint: string }> = {
	act: { word: 'Acts alone', hint: 'Inside the mandate' },
	propose: { word: 'Chef confirms', hint: "Needs the chef's approval" },
	sign_off: { word: 'Needs sign-off', hint: 'A named approver must sign' }
};

/**
 * A line reason or error code in the same plain words the kitchen uses (`$lib/ui/reasons.ts`, the one list).
 * An unlisted `CODE.sub` falls back to its code; anything else to readable words, never a raw enum.
 */
export function reasonText(r: string): string {
	const short = reasonShort(r);
	if (short !== r) return short;
	const code = r.split('.')[0];
	const byCode = reasonShort(code);
	return byCode !== code ? byCode : r.replaceAll('_', ' ').toLowerCase();
}

/** What each tool does, in words, for the trace drawer. */
export const TOOL: Record<string, string> = {
	get_context: 'Read the kitchen context',
	search_products: 'Searched the catalogue',
	quote: 'Asked Valio for terms',
	plan_event: 'Planned the event',
	place_order: 'Placed an order',
	edit_line: 'Edited a line',
	find_substitutes: 'Looked for substitutes',
	get_plan: 'Read the plan',
	explain_line: 'Explained a line',
	approve: 'Approved',
	commit_order: 'Ordered',
	set_mandate: 'Changed the mandate',
	lookup_facts: 'Looked up product facts',
	find_outside: 'Searched outside sources',
	check_recall: 'Checked a recall'
};
export const toolText = (name: string) => TOOL[name] ?? name.replaceAll('_', ' ');

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

const lines = (n: number) => `${n} line${n === 1 ? '' : 's'}`;
const decisions = (n: number) => `${n} decision${n === 1 ? '' : 's'}`;

/** Decisions among held lines, grouped by reason the way the kitchen groups an approval (decisionsOf). */
function decisionCount(plan: Plan | undefined, held: Line[]): number {
	if (!held.length) return 0;
	const p = { ...(plan ?? ({ needs: [] } as unknown as Plan)), lines: held } as Plan;
	const pending = { state: 'pending', lineIds: held.map((l) => l.id) } as unknown as Approval;
	return decisionsOf(p, pending).length;
}

/**
 * One plain sentence per op: the one source for the op log, the timeline, each case's story and /agents. in the kitchen's words: held lines are counted as
 * decisions (reason groups), not as raw lines. `plans` (the current plans) lets an approval name its decisions.
 */
export function opSummary(env: OpEnvelope, names: Names, plans: Record<string, Plan> = {}): string {
	const op = env.op;
	switch (op.type) {
		case 'CreatePlan':
			return op.plan.lines.length
				? `Drafted an order of ${lines(op.plan.lines.length)} for ${day(op.plan.deliverBy)}`
				: `Started an order for ${day(op.plan.deliverBy)}`;
		case 'EditLine':
			return `Edited: ${op.summary}`;
		case 'RecordOffer': {
			const held = op.lines.filter((l) => l.state === 'held');
			const cannot = op.lines.filter((l) => l.state === 'unorderable').length;
			const parts = [
				held.length
					? `${decisions(decisionCount(plans[op.planId], held))} for a person (${lines(held.length)})`
					: '',
				cannot ? `${cannot} can't be ordered` : ''
			].filter(Boolean);
			return `Quoted ${euro(op.totalCents)} on live terms${parts.length ? `: ${parts.join(', ')}` : ', all within the mandate'}`;
		}
		case 'ProposeSubstitute': {
			const forLine = op.lines[0]?.substituteFor;
			const sub = op.lines[0]?.productId;
			const instead = forLine ? ` instead of ${name(names, forLine)}` : '';
			const from = op.candidates.length ? ` from ${op.candidates.length} candidates` : '';
			if (!sub) return `Looked for a substitute${from}; none qualifies`;
			if (op.kind === 'make_in_house')
				return `No ready-made substitute qualifies, so planned it in house from ${lines(op.lines.length).replace('line', 'ingredient')}${instead}${op.labourNote ? ` (${op.labourNote})` : ''}`;
			return `Ranked substitutes${from} by the kitchen's own rules and proposed ${name(names, sub)}${instead}`;
		}
		case 'RecordApproval': {
			const a = op.approval;
			const n = lines(a.lineIds.length);
			if (a.state === 'pending') {
				const plan = plans[a.planId];
				const d = plan ? decisionsOf(plan, a).length : 0;
				const what = d ? `${decisions(d)} (${n})` : n;
				return a.tier === 'sign_off'
					? `Asked a named approver for ${what}`
					: `Asked the chef for ${what}`;
			}
			if (a.state === 'granted')
				return `${a.decidedBy ? ACTOR[a.decidedBy.kind] : 'Someone'} approved ${n}`;
			return `Approval ${a.state}${a.reason ? `: ${a.reason}` : ''}`;
		}
		case 'CommitOrder': {
			const o = op.outcome;
			if (o.result === 'failed') return `Order refused (${o.error.code}): ${o.error.message}`;
			const confirmed = o.receipt.confirmed.length;
			return `Ordered ${euro(o.order.totalCents)}, supplier confirmed ${confirmed} of ${o.order.lines.length} lines`;
		}
		case 'RecordAnomaly':
			return op.anomaly.message;
		case 'RecordEnrichment':
			return `Added ${op.field} for ${name(names, op.productId)} (${op.provenance.source})`;
		case 'RecordRefusal':
			return refusalWhat(env.actor.kind, op.tool);
	}
}

/** "An outside agent tried to approve on the chef's behalf", for the log and the story. */
export function refusalWhat(actor: ActorKind, tool: string): string {
	const who = actor === 'external_agent' ? 'An outside agent' : 'The kitchen agent';
	const what: Record<string, string> = {
		approve: "tried to approve on the chef's behalf",
		set_mandate: "tried to change the kitchen's mandate",
		commit_order: 'tried to commit an order it may not commit',
		place_order: 'tried to place an order it may not place'
	};
	return `${who} ${what[tool] ?? `tried to ${toolText(tool).toLowerCase()} without the right`}`;
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
