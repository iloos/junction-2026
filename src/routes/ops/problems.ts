/**
 * Problems: the first Ops screen, one card per cause, consequence first ("Christmas ham: 28 kg short for 1
 * kitchen"). An outage and the rescue agents proposed for it are one problem, across every kitchen it touches;
 * held lines that answer no outage group by the decision they wait on; anomalies and refused commits follow.
 * Pure: derived from the reduced WorkspaceState (plans carry their views when /ops has them) and the op log.
 */
import type { Line, OpEnvelope, Plan } from '$lib/core/contracts';
import { SCENARIO } from '$lib/core/scenario';
import type { WorkspaceState } from '$lib/core/state';
import { decisionsOf } from '$lib/ui/decisions';
import { salesUnitWords } from '$lib/ui/request/words';
import { pendingApprovalOf } from './cases';
import { dueOf } from '$lib/core/mandate/due';
import { productName, reasonText, type Names } from './labels';

/** Who the problem waits on now. */
export type Waits = 'chef' | 'approver' | 'agents' | 'operations';
/** blocked: nothing answers it yet · sign_off / propose: a person decides · quiet: nothing is held. */
export type ProblemTone = 'blocked' | 'sign_off' | 'propose' | 'quiet';

export interface Problem {
	id: string;
	kind: 'outage' | 'held' | 'anomaly' | 'refused';
	tone: ProblemTone;
	/** The consequence, with product and count. */
	title: string;
	/** What happened and what follows if nothing changes. */
	detail: string;
	/** What agents already did about it, from the op log ("Agents already proposed …"); null when nothing. */
	already: string | null;
	waits: Waits;
	/** Euros on the lines waiting for a person. */
	heldCents: number;
	/** Earliest offer closing time of its lines, else the scenario cut-off (ISO). */
	deadline: string | null;
	kitchenIds: string[];
	/** The plan lines this problem stands for, outage and rescue both. */
	lines: { planId: string; lineId: string }[];
	/** Products it concerns (the outage and its rescue), for the story and the product sheet. */
	productIds: string[];
	/** Where the kitchen shows it: the first plan line. */
	at: { kitchenId: string; planId: string; version: number; needId?: string } | null;
}

const EPS = 1e-9;
const LIVE: ReadonlySet<Line['state']> = new Set(['proposed', 'eligible', 'held', 'committed']);
const TONE_RANK: Record<ProblemTone, number> = { blocked: 0, sign_off: 1, propose: 2, quiet: 3 };

/** "Joulukinkku (Christmas ham)" → "Christmas ham"; a label without an English gloss stays as it is. */
export function dishName(label: string): string {
	const s = dishPhrase(label);
	return s.charAt(0).toUpperCase() + s.slice(1);
}
/** The same name as written mid-sentence ("swede casserole", "Christmas ham"). */
export function dishPhrase(label: string): string {
	const m = /\(([^)]+)\)(.*)$/.exec(label);
	if (!m) return label.trim();
	// "Riisipuuro (rice porridge): rice" keeps its part: rice and milk are two needs of one dish.
	const part = m[2].trim().startsWith(':') ? m[2].trim() : '';
	return `${m[1].trim()}${part}`;
}

const kitchens = (n: number) => `${n} kitchen${n === 1 ? '' : 's'}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const earliest = (a: string | null, b: string | null | undefined) =>
	!b ? a : !a ? b : new Date(a).getTime() <= new Date(b).getTime() ? a : b;
const list = (xs: string[]) =>
	xs.length <= 2
		? xs.join(' and ')
		: xs.length === 3
			? `${xs[0]}, ${xs[1]} and ${xs[2]}`
			: `${xs.slice(0, 2).join(', ')} and ${xs.length - 2} more`;

/** Lines of `plan` that answer the outage `u`: a substitute for its product, or another line for its need. */
function rescueOf(plan: Plan, u: Line): Line[] {
	return plan.lines.filter(
		(x) =>
			x.id !== u.id &&
			LIVE.has(x.state) &&
			(x.substituteFor === u.productId || (!!u.needId && x.needId === u.needId))
	);
}

/** Whether a held line waits for a named approver (its tier, or its decision group's). */
function signOffLines(s: WorkspaceState, plan: Plan): Set<string> {
	const out = new Set(plan.lines.filter((l) => l.tier === 'sign_off').map((l) => l.id));
	for (const d of decisionsOf(plan, pendingApprovalOf(s, plan.id)))
		if (d.signOff) d.lineIds.forEach((id) => out.add(id));
	return out;
}

const WAITS_WORDS: Record<Waits, string> = {
	chef: 'the chef',
	approver: 'a named approver',
	agents: 'the agents',
	operations: 'Valio operations'
};

/** The newest ProposeSubstitute in the log for a plan's outage product. */
function proposalFor(log: OpEnvelope[], planId: string, productId: string) {
	for (let i = log.length - 1; i >= 0; i--) {
		const op = log[i].op;
		if (op.type === 'ProposeSubstitute' && op.planId === planId) {
			if (op.lines.some((l) => l.substituteFor === productId)) return op;
			if (op.lines.length === 0 && op.forLineId.endsWith(productId)) return op;
		}
	}
	return undefined;
}

export function buildProblems(
	s: WorkspaceState,
	names: Names,
	/** Ops of the current run, in seq order. */
	log: OpEnvelope[] = []
): Problem[] {
	const plans = Object.values(s.plans);
	const out: Problem[] = [];
	/** Lines an outage problem already stands for (its rescue), so they are not counted twice below. */
	const taken = new Set<string>();
	const key = (planId: string, lineId: string) => `${planId}:${lineId}`;

	// 1. Outages, one problem per product across plans.
	type Hit = { plan: Plan; u: Line; rescue: Line[]; signOff: Set<string> };
	const outages = new Map<string, Hit[]>();
	for (const plan of plans)
		for (const u of plan.lines) {
			if (u.state !== 'unorderable') continue;
			const rescue = rescueOf(plan, u);
			const waiting = rescue.filter((l) => l.state === 'held' || l.state === 'proposed');
			if (!waiting.length) {
				// Answered by an orderable or committed line, or covered according to the plan view.
				if (rescue.length) continue;
				const f = plan.view?.fulfilment.find((x) => x.needId === u.needId);
				if (f && f.unresolved.value <= EPS) continue;
			}
			const hits = outages.get(u.productId) ?? [];
			hits.push({ plan, u, rescue, signOff: signOffLines(s, plan) });
			outages.set(u.productId, hits);
		}

	for (const [productId, hits] of outages) {
		const first = hits[0];
		const dishLabel =
			first.plan.needs.find((n) => n.id === first.u.needId)?.label ?? productName(names, productId);
		const dish = dishName(dishLabel);
		const phrase = dishPhrase(dishLabel);
		const undeliverable = first.u.reasons.includes('undeliverable');
		const units = new Set(hits.map((h) => h.u.qty.unit));
		const amount =
			units.size === 1
				? salesUnitWords(
						hits.reduce((n, h) => n + h.u.qty.value, 0),
						first.u.qty.unit
					)
				: null;
		const k = new Set(hits.map((h) => h.plan.kitchenId)).size;
		const title = undeliverable
			? `${dish}: ${amount ? `${amount} can't be delivered` : "can't be delivered"} for ${kitchens(k)}`
			: `${dish}: ${amount ? `${amount} short` : 'out of stock'} for ${kitchens(k)}`;

		const held = hits.flatMap((h) =>
			h.rescue.filter((l) => l.state === 'held').map((l) => ({ h, l }))
		);
		const anySignOff = held.some(({ h, l }) => h.signOff.has(l.id));
		// Held rescue lines wait for a person; proposed ones (not yet quoted) and no rescue at all wait for agents.
		const waits: Waits = held.length ? (anySignOff ? 'approver' : 'chef') : 'agents';
		const tone: ProblemTone = !held.length ? 'blocked' : anySignOff ? 'sign_off' : 'propose';

		const what = `${productName(names, productId)} (${productId}) ${
			undeliverable ? "can't be delivered by the date the kitchens need" : 'is out at Valio'
		}.`;
		const consequence = held.length
			? `Unless ${WAITS_WORDS[waits]} decides, ${k === 1 ? 'the kitchen goes' : `${k} kitchens go`} without ${phrase}.`
			: `No substitute qualifies yet: ${k === 1 ? 'the kitchen goes' : `${k} kitchens go`} without ${phrase}.`;

		// What agents already did, from the newest proposal per plan.
		const proposals = hits
			.map((h) => proposalFor(log, h.plan.id, productId))
			.filter((p): p is NonNullable<typeof p> => !!p);
		let already: string | null = null;
		if (proposals.length) {
			const inHouse = proposals.filter((p) => p.kind === 'make_in_house' && p.lines.length);
			const swaps = proposals.filter((p) => p.kind === 'product' && p.lines.length);
			const none = proposals.filter((p) => !p.lines.length).length;
			const parts: string[] = [];
			if (swaps.length) {
				const subs = [...new Set(swaps.map((p) => productName(names, p.lines[0].productId)))];
				parts.push(
					`proposed ${list(subs)} instead${k > 1 ? ` for ${kitchens(swaps.length)}` : ''}`
				);
			}
			if (inHouse.length) {
				const n = Math.max(...inHouse.map((p) => p.lines.length));
				parts.push(
					`planned it in house from ${plural(n, 'ingredient')}${k > 1 ? ` for ${kitchens(inHouse.length)}` : ''}`
				);
			}
			if (none) parts.push(`found no substitute that qualifies for ${kitchens(none)}`);
			const reasons = [
				...new Set(held.flatMap(({ l }) => l.reasons.filter((r) => r !== 'UNKNOWN_REQUIRED')))
			].map((r) => reasonText(r).toLowerCase());
			const tail = held.length
				? ` · waits for ${WAITS_WORDS[waits]}${reasons.length ? ` (${reasons.join(', ')})` : ''}`
				: '';
			already = `Agents already ${parts.join(' and ')}${tail}`;
		}

		// When it is due: dueOf (core/mandate/due.ts) over each plan's lines in question, the earliest across plans.
		let deadline: string | null = null;
		for (const h of hits)
			deadline = earliest(
				deadline,
				dueOf(h.plan, pendingApprovalOf(s, h.plan.id), [
					h.u,
					...h.rescue.filter((l) => l.state === 'held' || l.state === 'proposed')
				])
			);
		const lines = hits.flatMap((h) => [
			{ planId: h.plan.id, lineId: h.u.id },
			...h.rescue.map((l) => ({ planId: h.plan.id, lineId: l.id }))
		]);
		for (const x of lines) taken.add(key(x.planId, x.lineId));
		out.push({
			id: `outage:${productId}`,
			kind: 'outage',
			tone,
			title,
			detail: `${what} ${consequence}`,
			already,
			waits,
			heldCents: held.reduce((n, { l }) => n + (l.lineCents ?? 0), 0),
			deadline: deadline ?? SCENARIO.cutoff,
			kitchenIds: [...new Set(hits.map((h) => h.plan.kitchenId))],
			lines,
			productIds: [productId, ...new Set(hits.flatMap((h) => h.rescue.map((l) => l.productId)))],
			at: {
				kitchenId: first.plan.kitchenId,
				planId: first.plan.id,
				version: first.plan.version,
				needId: first.u.needId
			}
		});
	}

	// 2. Held lines that answer no outage, grouped by the decision they wait on (across kitchens, by reason).
	type Group = { reason: string; signOff: boolean; items: { plan: Plan; l: Line }[] };
	const groups = new Map<string, Group>();
	for (const plan of plans) {
		const decisionOf = new Map<string, { reason: string; signOff: boolean }>();
		for (const d of decisionsOf(plan, pendingApprovalOf(s, plan.id)))
			for (const id of d.lineIds) decisionOf.set(id, d);
		for (const l of plan.lines) {
			if (l.state !== 'held' || taken.has(key(plan.id, l.id))) continue;
			const d = decisionOf.get(l.id);
			const reason =
				d?.reason ||
				l.reasons
					.filter((r) => r !== 'UNKNOWN_REQUIRED')
					.map(reasonText)
					.join(' · ') ||
				'Held';
			const signOff = !!d?.signOff || l.tier === 'sign_off';
			const g = groups.get(reason) ?? { reason, signOff: false, items: [] };
			g.items.push({ plan, l });
			g.signOff ||= signOff;
			groups.set(reason, g);
		}
	}
	for (const g of groups.values()) {
		const dishes = [
			...new Set(
				g.items.map(({ plan, l }) => {
					const label = plan.needs.find((n) => n.id === l.needId)?.label;
					return label ? dishName(label) : productName(names, l.productId);
				})
			)
		];
		const k = new Set(g.items.map((x) => x.plan.kitchenId)).size;
		const waits: Waits = g.signOff ? 'approver' : 'chef';
		const n = g.items.length;
		const title = `${list(dishes)}: ${plural(n, 'line')} not ordered until ${WAITS_WORDS[waits]} decides`;
		const asked = askedBy(log, g.items, WAITS_WORDS[waits]);
		let deadline: string | null = null;
		for (const plan of new Set(g.items.map((x) => x.plan)))
			deadline = earliest(
				deadline,
				dueOf(
					plan,
					pendingApprovalOf(s, plan.id),
					g.items.filter((x) => x.plan === plan).map((x) => x.l)
				)
			);
		const first = g.items[0];
		out.push({
			id: `held:${g.reason}`,
			kind: 'held',
			tone: g.signOff ? 'sign_off' : 'propose',
			title,
			detail: `Held because: ${g.reason.toLowerCase()}. Nothing on these lines is ordered until ${WAITS_WORDS[waits]} answers${k > 1 ? ` in each of ${kitchens(k)}` : ''}.`,
			already: asked,
			waits,
			heldCents: g.items.reduce((s2, { l }) => s2 + (l.lineCents ?? 0), 0),
			deadline: deadline ?? SCENARIO.cutoff,
			kitchenIds: [...new Set(g.items.map((x) => x.plan.kitchenId))],
			lines: g.items.map(({ plan, l }) => ({ planId: plan.id, lineId: l.id })),
			productIds: [...new Set(g.items.map(({ l }) => l.productId))],
			at: {
				kitchenId: first.plan.kitchenId,
				planId: first.plan.id,
				version: first.plan.version,
				needId: first.l.needId
			}
		});
	}

	// 3. Anomalies (recalls, demand spikes). One that holds nothing is quiet and sorts last.
	const heldProducts = new Set(
		plans.flatMap((p) =>
			p.lines.filter((l) => l.state === 'held' || l.state === 'unorderable').map((l) => l.productId)
		)
	);
	for (const a of Object.values(s.anomalies)) {
		const plan = a.planId ? s.plans[a.planId] : undefined;
		const holds = !!a.productId && heldProducts.has(a.productId);
		out.push({
			id: `anomaly:${a.id}`,
			kind: 'anomaly',
			tone: holds ? 'blocked' : 'quiet',
			title: a.productId
				? `${a.kind === 'recall' ? 'Recall notice' : dishName(a.kind.replaceAll('_', ' '))}: ${productName(names, a.productId)}`
				: a.message,
			detail: holds
				? `${a.message} Lines with this product are held until someone checks.`
				: `${a.message} Nothing is held because of it.`,
			already: null,
			waits: 'operations',
			heldCents: 0,
			deadline: holds ? SCENARIO.cutoff : null,
			kitchenIds: plan ? [plan.kitchenId] : [],
			lines: [],
			productIds: a.productId ? [a.productId] : [],
			at: plan ? { kitchenId: plan.kitchenId, planId: plan.id, version: plan.version } : null
		});
	}

	// 4. Refused commits: the latest per plan, none once the plan has committed.
	const refused = new Map<string, WorkspaceState['failedCommits'][number]>();
	for (const f of s.failedCommits)
		if ((refused.get(f.planId)?.seq ?? -1) < f.seq) refused.set(f.planId, f);
	for (const f of refused.values()) {
		const plan = s.plans[f.planId];
		if (!plan || plan.state === 'committed') continue;
		out.push({
			id: `refused:${f.planId}`,
			kind: 'refused',
			tone: 'blocked',
			title: `Order refused: ${reasonText(f.code).toLowerCase()}`,
			detail: 'The rules stopped the commit and nothing was ordered. It needs the approval first.',
			already: null,
			waits: 'agents',
			heldCents: 0,
			deadline: SCENARIO.cutoff,
			kitchenIds: [plan.kitchenId],
			lines: [],
			productIds: [],
			at: { kitchenId: plan.kitchenId, planId: plan.id, version: plan.version }
		});
	}

	// Something held first and quiet notices last; causes (outages, refusals, anomalies) before plain holds;
	// then the most money waiting, then the nearest cut-off.
	const due = (p: Problem) => (p.deadline ? new Date(p.deadline).getTime() : Infinity);
	return out.sort(
		(a, b) =>
			(a.tone === 'quiet' ? 1 : 0) - (b.tone === 'quiet' ? 1 : 0) ||
			(a.kind === 'held' ? 1 : 0) - (b.kind === 'held' ? 1 : 0) ||
			b.heldCents - a.heldCents ||
			due(a) - due(b) ||
			TONE_RANK[a.tone] - TONE_RANK[b.tone]
	);
}

/** "Agents already asked the chef" from the newest pending approval that covers any of these lines. */
function askedBy(log: OpEnvelope[], items: { plan: Plan; l: Line }[], who: string): string | null {
	for (let i = log.length - 1; i >= 0; i--) {
		const env = log[i];
		const op = env.op;
		if (op.type !== 'RecordApproval' || op.approval.state !== 'pending') continue;
		const a = op.approval;
		if (!items.some(({ plan, l }) => plan.id === a.planId && a.lineIds.includes(l.id))) continue;
		const by =
			env.actor.kind === 'kitchen_agent' || env.actor.kind === 'external_agent'
				? 'Agents already'
				: 'Already';
		return `${by} priced them on live terms and asked ${who}`;
	}
	return null;
}
