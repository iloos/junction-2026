/**
 * "What happened to this case": a problem's ops as a story, one step per op that changed something about its
 * lines, in seq order, each in one sentence plus its consequence. Pure: the op log and the reduced state.
 */
import type { Line, OpEnvelope } from '$lib/core/contracts';
import type { WorkspaceState } from '$lib/core/state';
import { euro, productName, reasonText, type Names } from './labels';
import { dishPhrase, type Problem } from './problems';

/** Who a step is from, as its chip reads. */
export type Chip = 'valio' | 'kitchen_agent' | 'chef' | 'approver' | 'outside' | 'job' | 'system';
export const CHIP: Record<Chip, string> = {
	valio: 'Valio data',
	kitchen_agent: 'Kitchen agent',
	chef: 'Chef',
	approver: 'Approver',
	outside: 'Outside agent · MCP',
	job: 'Monitor job',
	system: 'System'
};

export interface StoryStep {
	seq: number;
	at: string;
	chip: Chip;
	/** What happened, one sentence. */
	what: string;
	/** What it changed. */
	then: string;
	tone: 'bad' | 'warn' | 'ok' | 'plain';
}

function chipOf(env: OpEnvelope): Chip {
	switch (env.actor.kind) {
		case 'external_agent':
			return 'outside';
		case 'job':
			return 'job';
		case 'chef':
			return 'chef';
		case 'approver':
			return 'approver';
		case 'kitchen_agent':
			return 'kitchen_agent';
		default:
			return 'system';
	}
}

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;
const sentence = (t: string) => (t ? t.charAt(0).toUpperCase() + t.slice(1) + '.' : '');

const AVAIL: Record<string, string> = {
	known: 'in stock',
	unknown: "in Valio's range, quantity not stated",
	supplier: 'delivered by its supplier, quantity not stated'
};

function planOf(env: OpEnvelope): string | undefined {
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

/**
 * Ops that touch other lines are left out. An op of this problem's plans that the story has no sentence for is
 * counted in `hidden`, never given a vague one.
 */
export function storyOf(
	p: Problem,
	log: OpEnvelope[],
	s: WorkspaceState,
	names: Names
): { steps: StoryStep[]; hidden: number } {
	const plans = new Set(p.lines.map((l) => l.planId).concat(p.at ? [p.at.planId] : []));
	const lineIds = new Set(p.lines.map((l) => l.lineId));
	const products = new Set(p.productIds);
	const mine = (l: Pick<Line, 'id' | 'productId'>) =>
		lineIds.has(l.id) || products.has(l.productId);
	const name = (id: string) => productName(names, id);
	const steps: StoryStep[] = [];
	let hidden = 0;
	/** Last seen state per plan line, to tell what an offer changed. */
	const seen = new Map<string, string>();
	/** Who has been asked already: a later request on a changed plan says so. */
	const asked = new Set<string>();

	for (const env of log) {
		const op = env.op;
		const base = { seq: env.seq, at: env.at, chip: chipOf(env) };
		if (op.type === 'RecordAnomaly') {
			if (!op.anomaly.productId || !products.has(op.anomaly.productId)) continue;
			steps.push({
				...base,
				what: op.anomaly.message,
				then:
					p.tone === 'quiet'
						? 'Nothing was held because of it.'
						: 'Lines with this product are held until someone checks.',
				tone: 'warn'
			});
			continue;
		}
		const planId = planOf(env);
		if (!planId || !plans.has(planId)) continue;

		switch (op.type) {
			case 'CreatePlan': {
				const n = op.plan.lines.length;
				steps.push({
					...base,
					what:
						n === 0
							? `Started an order for delivery ${op.plan.deliverBy}.`
							: `Drafted an order of ${plural(n, 'line')} for delivery ${op.plan.deliverBy}.`,
					then:
						n === 0 ? 'Lines follow as the menu is worked out.' : 'Next: live terms from Valio.',
					tone: 'plain'
				});
				break;
			}
			case 'RecordOffer': {
				const changed = op.lines.filter((l) => mine(l) && seen.get(l.id) !== l.state);
				for (const l of op.lines) seen.set(l.id, l.state);
				if (!changed.length) continue;
				const out = changed.filter((l) => l.state === 'unorderable');
				const held = changed.filter((l) => l.state === 'held');
				const fine = changed.filter((l) => l.state === 'eligible');
				const what: string[] = [];
				const then: string[] = [];
				for (const l of out) {
					const late = l.reasons.includes('undeliverable');
					what.push(`${name(l.productId)} ${late ? "can't be delivered in time" : 'is out'}`);
					const need = s.plans[planId]?.needs.find((n) => n.id === l.needId)?.label;
					if (need) then.push(`the plan lost its ${dishPhrase(need)}`);
				}
				if (held.length) {
					const kinds = [
						...new Set(held.map((l) => AVAIL[l.offer?.availability.kind ?? ''] ?? ''))
					].filter(Boolean);
					what.push(
						held.length === 1
							? `${name(held[0].productId)} is ${kinds[0] ?? 'priced'}`
							: `${held.length} of these lines are priced${kinds.length === 1 ? `, ${kinds[0]}` : ''}`
					);
					const reasons = [
						...new Set(held.flatMap((l) => l.reasons.filter((r) => r !== 'UNKNOWN_REQUIRED')))
					].map((r) => reasonText(r).toLowerCase());
					then.push(`held for a person${reasons.length ? ` (${reasons.join(', ')})` : ''}`);
				}
				if (fine.length) {
					what.push(`${plural(fine.length, 'line')} can be ordered within the mandate`);
					then.push('nobody needs to be asked for those');
				}
				steps.push({
					...base,
					chip: 'valio',
					what: `Valio's live terms: ${what.join('; ')}.`,
					then: sentence(then.join('; ')),
					tone: out.length ? 'bad' : held.length ? 'warn' : 'ok'
				});
				break;
			}
			case 'ProposeSubstitute': {
				const forMe =
					lineIds.has(op.forLineId) || op.lines.some((l) => products.has(l.substituteFor ?? ''));
				if (!forMe) continue;
				const ranked = op.candidates.length
					? ` from ${plural(op.candidates.length, 'candidate')}`
					: '';
				if (!op.lines.length)
					steps.push({
						...base,
						what: `Agents looked for a substitute${ranked}; none qualifies.`,
						then: 'Nothing changed: the line still cannot be ordered.',
						tone: 'bad'
					});
				else if (op.kind === 'make_in_house')
					steps.push({
						...base,
						what: `No ready-made substitute qualifies, so agents planned it in house: ${plural(op.lines.length, 'ingredient')}${op.labourNote ? ` (${op.labourNote})` : ''}.`,
						then: 'Proposed, not ordered: the ingredients are priced next.',
						tone: 'plain'
					});
				else
					steps.push({
						...base,
						what: `Agents ranked substitutes${ranked} by the kitchen's own rules and proposed ${name(op.lines[0].productId)}.`,
						then: 'Proposed, not ordered: it is priced next.',
						tone: 'plain'
					});
				break;
			}
			case 'RecordApproval': {
				const a = op.approval;
				const k = a.lineIds.filter((id) => lineIds.has(id)).length;
				if (!k) continue;
				const who = a.tier === 'sign_off' ? 'a named approver' : 'the chef';
				const these = k === 1 ? 'this line' : `${k} of these lines`;
				if (a.state === 'pending') {
					// A request on a changed plan replaces the earlier one (any edit voids an approval).
					const what = !asked.size
						? `Asked ${who} to decide on ${these}.`
						: asked.has(who)
							? `Asked ${who} again on the changed plan (${these}); the earlier request lapsed.`
							: `Asked again on the changed plan, now ${who} (${these}); the earlier request lapsed.`;
					asked.add(who);
					steps.push({
						...base,
						what,
						then: 'Nothing is ordered until they answer.',
						tone: 'warn'
					});
				} else if (a.state === 'granted')
					steps.push({
						...base,
						what: `${a.decidedBy?.kind === 'approver' ? 'The approver' : 'The chef'} approved ${these}.`,
						then: 'They can be ordered now, on exactly these terms.',
						tone: 'ok'
					});
				else
					steps.push({
						...base,
						what: `The approval was ${a.state}${a.reason ? `: ${a.reason}` : ''}.`,
						then:
							a.state === 'denied'
								? 'Those lines are not ordered.'
								: 'A new approval is needed before anything is ordered.',
						tone: a.state === 'denied' ? 'bad' : 'warn'
					});
				break;
			}
			case 'CommitOrder': {
				const o = op.outcome;
				if (o.result === 'failed') {
					steps.push({
						...base,
						what: `A commit was refused: ${reasonText(o.error.code).toLowerCase()}.`,
						then: 'Nothing was ordered and nothing changed.',
						tone: 'bad'
					});
					break;
				}
				const k = o.order.lines.filter(
					(l) => lineIds.has(l.lineId) || products.has(l.productId)
				).length;
				if (!k) continue;
				steps.push({
					...base,
					what: `Ordered ${k === 1 ? 'the line' : `${k} of these lines`}, ${euro(o.order.totalCents)} for the whole order.`,
					then: `Valio confirmed ${o.receipt.confirmed.length} of ${o.order.lines.length} lines.`,
					tone: 'ok'
				});
				break;
			}
			case 'EditLine': {
				if (!op.lines.some((x) => lineIds.has(x.lineId))) continue;
				steps.push({
					...base,
					what: `Edited: ${op.summary}.`,
					then: 'The plan changed, so any approval for it is void.',
					tone: 'plain'
				});
				break;
			}
			default:
				hidden += 1;
		}
	}
	return { steps, hidden };
}
