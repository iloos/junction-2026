/**
 * The kitchen screen's server side in live mode. The browser never holds a key: it calls /kitchen-api/*, and this
 * module acts as the chef through the same tool handlers REST, MCP and the agent use (one gate, one store, one bus).
 * The snapshot is assembled here because the view needs product facts (origin, availability) for every candidate,
 * which the catalogue port has and the tool outputs don't carry.
 *
 * Public-demo authority model (round-4 triage #2): this helper is not a general chef. It forwards only the
 * commands the kitchen screen needs, only against the plan of the session's selected kitchen, and reading the
 * snapshot never changes state (planning is the explicit `start` command). Selection is per browser session.
 */
import { env } from '$env/dynamic/private';
import type { Approval, Kitchen, ToolInput, ToolName } from '$lib/core/contracts';
import { isoWeek } from '$lib/core/mandate/tier';
import { contextFor } from '$lib/server/auth';
import { createServerPorts } from '$lib/server/store/server-ports';
import { handlers } from '$lib/server/tools/handlers';
import { serveTool, type Served } from '$lib/server/tools/serve';
import { rulesFor, type PresetId } from '$lib/kitchen/fixture-plan';
import type { CommitRecord, FixtureSnapshot } from '$lib/kitchen/fixture-server';
import { buildLiveView, type ProductFacts, type SubstitutesOut } from '$lib/kitchen/live-view';
import seed from '../../../../fixtures/seeds/christmas-buffet-140.json';
import { scenarioClock } from '$lib/core/scenario';
import { currentRun, currentRunStartedAt } from '$lib/server/demo/run';
import { resetDemoRun } from '$lib/server/demo/reset';
import { dev } from '$app/environment';
import { presenterOpen } from '$lib/server/demo/presenter';
import { JUDGES_WORKSPACE } from '$lib/server/auth';

const EVENT_ID = 'event-xmas-140';
/** The palvikinkku the ham rescue relies on (13 of 15 in stock): the contention preset takes 4 of them. */
const CONTENDED = { productId: '476768', left: 11 };

export interface Session {
	/** Stage run (ws-demo) or the judges' sandbox (ws-judges); fixed for the session's life. */
	workspaceId: string;
	kitchenId: string;
	preset: PresetId;
	contention: boolean;
}

/** Selection per browser session (cookie id). The simulator overlay itself is run-wide: see `contention`. */
const sessions = new Map<string, Session>();
export function session(id: string): Session {
	let s = sessions.get(id);
	if (!s) {
		s = {
			workspaceId: kitchenWorkspace(),
			kitchenId: 'k-hotel',
			preset: 'kitchen',
			contention: false
		};
		sessions.set(id, s);
	}
	return s;
}

/** The commands the screen may send through the helper. Planning and resets go through `scenario`. */
const ALLOWED = new Set(['get_plan', 'edit_line', 'explain_line', 'approve', 'commit_order']);

/**
 * Which workspace a new kitchen session uses. Dev: the stage run. Production: public visitors get the judges'
 * sandbox; the stage run only when presenterOpen (dev, or DEMO_RESET_OPEN=1). KITCHEN_WORKSPACE overrides.
 */
export function kitchenWorkspace(presenter = presenterOpen(env, dev)): string {
	if (env.KITCHEN_WORKSPACE) return env.KITCHEN_WORKSPACE;
	return presenter ? 'ws-demo' : JUDGES_WORKSPACE;
}

const chef = (s: Session) => contextFor('chef', 'kitchen-ui', 'kitchen', env, s.workspaceId);
const agent = (s: Session) =>
	contextFor('kitchen_agent', 'kitchen-agent', 'kitchen', env, s.workspaceId);

/**
 * One kitchen request at a time. The snapshot plans and ranks with several tool calls against one plan version;
 * a chef edit landing in between would make those calls stale, so screen requests queue behind each other.
 */
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
	const next = queue.then(fn, fn);
	queue = next.catch(() => undefined);
	return next;
}

/** One allowlisted tool call as the chef, through the shared gate, and only on this session's plan. */
export function callTool(sid: string, name: string, input: unknown): Promise<Served> {
	return serial(async () => {
		const deny = (message: string): Served => ({
			ok: false,
			status: 403,
			error: { code: 'FORBIDDEN', message, retryable: false }
		});
		if (!ALLOWED.has(name)) return deny(`the kitchen screen does not send ${name}`);
		const s = session(sid);
		const plan = await findPlan(s);
		const i = (input ?? {}) as { planId?: string; approvalId?: string };
		if (!plan) return deny('start the demo first');
		if (i.planId !== undefined && i.planId !== plan.id)
			return deny("that plan is not this session's kitchen plan");
		if (name === 'approve' && !(i.approvalId ?? '').includes(plan.id))
			return deny("that approval is not for this session's plan");
		return serveTool(name, chef(s), input, handlers);
	});
}

/** The session kitchen's event plan if it exists: a read, never a planning call. */
async function findPlan(s: Session) {
	const ctx = chef(s);
	const b = await createServerPorts();
	const ws = await b.ports.store.load(ctx.workspaceId, ctx.runId);
	return (
		Object.values(ws.plans).find((p) => p.kitchenId === s.kitchenId && p.eventId === EVENT_ID) ??
		null
	);
}

async function must<N extends ToolName>(
	s: Session,
	name: N,
	input: ToolInput<N>,
	ctx = chef(s)
): Promise<unknown> {
	const r = await serveTool(name, ctx, input, handlers);
	if (!r.ok) throw new Error(`${name}: ${r.error.code} ${r.error.message}`);
	return r.value;
}

type PlanOut = { plan: import('$lib/core/contracts').Plan };

/** Plans the event, then lets the kitchen agent propose a rescue for every real outage that has none yet. */
async function ensurePlan(s: Session) {
	let { plan } = (await must(s, 'plan_event', {
		kitchenId: s.kitchenId,
		eventId: EVENT_ID
	})) as PlanOut;
	// Each outage is tried at most once per call, and the loop is capped: a dish with no qualifying substitute
	// stays a stated shortfall instead of being retried (a retry loop once wrote ~1,000 empty proposals).
	const tried = new Set<string>();
	for (let i = 0; i < 10; i++) {
		const covered = new Set(plan.lines.map((l) => l.substituteFor).filter(Boolean));
		const out = plan.lines.find(
			(l) =>
				l.state === 'unorderable' &&
				!l.substituteFor &&
				!covered.has(l.productId) &&
				!tried.has(l.id)
		);
		if (!out) return plan;
		tried.add(out.id);
		const r = (await must(
			s,
			'find_substitutes',
			{ planId: plan.id, version: plan.version, lineId: out.id },
			agent(s)
		)) as SubstitutesOut;
		if (r.applied) plan = r.plan;
	}
	return plan;
}

/** Always passes weights, so find_substitutes ranks as a preview and persists nothing. */
function presetInput(kitchen: Kitchen, s: Session) {
	const rules = rulesFor(kitchen, s.preset);
	return {
		weights: rules.weights as Record<string, number>,
		...(s.preset === 'finnish' ? { requireOrigin: 'fi' } : {})
	};
}

export type LiveSnapshot = FixtureSnapshot | { started: false; kitchenId: string };

export function snapshot(sid: string): Promise<LiveSnapshot> {
	return serial(() => buildSnapshot(session(sid)));
}

async function buildSnapshot(s: Session): Promise<LiveSnapshot> {
	const ctx = chef(s);
	const planned = await findPlan(s);
	if (!planned) return { started: false, kitchenId: s.kitchenId };
	const b = await createServerPorts();
	const kitchens = await b.ports.store.kitchens(ctx.workspaceId);
	const kitchen = kitchens.find((k) => k.id === s.kitchenId) ?? kitchens[0];
	const { plan } = (await must(s, 'get_plan', { planId: planned.id })) as PlanOut;

	// Rankings under the active rules preset (previews: nothing is persisted).
	const rescues: Record<string, SubstitutesOut> = {};
	for (const l of plan.lines.filter((x) => x.state === 'unorderable' && !x.substituteFor))
		rescues[l.id] = (await must(s, 'find_substitutes', {
			planId: plan.id,
			version: plan.version,
			lineId: l.id,
			...presetInput(kitchen, s)
		})) as SubstitutesOut;

	const ids = [
		...new Set([
			...plan.lines.map((l) => l.productId),
			...Object.values(rescues).flatMap((r) => r.candidates.map((c) => c.productId))
		])
	];
	const [products, { offers }] = await Promise.all([
		b.ports.catalog.get(ids),
		b.ports.catalog.offers(ids, plan.deliverBy)
	]);
	const facts: Record<string, ProductFacts> = {};
	for (const id of ids) {
		const p = products.get(id);
		if (!p) continue;
		facts[id] = {
			name: p.nameFi,
			origin: p.origin,
			reliability: p.reliability,
			co2PerKg: p.co2PerKg?.value,
			salesUnit: p.salesUnit,
			offer: offers.find((o) => o.productId === id)
		};
	}

	const ws = await b.ports.store.load(ctx.workspaceId, ctx.runId);
	const approvals = Object.values(ws.approvals).filter((a) => a.planId === plan.id);
	const current =
		approvals
			.filter((a) => a.state === 'pending' || a.state === 'granted')
			.sort((a, b) => b.planVersion - a.planVersion)[0] ?? null;
	const lastInvalidated: Approval | null =
		approvals
			.filter((a) => a.state === 'invalidated')
			.sort((a, b) => b.planVersion - a.planVersion)[0] ?? null;
	const orders: CommitRecord[] = Object.values(ws.orders)
		.filter((o) => o.planId === plan.id)
		.sort((a, b) => (a.committedAt < b.committedAt ? -1 : 1))
		.map((o) => {
			const receipt = Object.values(ws.receipts).find((r) => r.orderId === o.id)!;
			return {
				output: {
					orderId: o.id,
					receiptId: receipt?.id ?? '',
					totalCents: o.totalCents,
					committedLineIds: o.lines.map((l) => l.lineId),
					awaitingSupplier: (receipt?.awaitingSupplier ?? []).map((a) => a.productId)
				},
				receipt,
				lines: plan.lines.filter((l) => o.lines.some((x) => x.lineId === l.id)),
				at: o.committedAt
			};
		});
	const week = isoWeek(plan.deliverBy);
	const spent = await b.ports.store.transact(ctx.workspaceId, async (tx) => ({
		ops: [],
		value: await b.ports.store.lockBudget(tx, {
			workspaceId: ctx.workspaceId,
			kitchenId: kitchen.id,
			week
		})
	}));
	const rules = rulesFor(kitchen, s.preset, kitchen.mandate.version);
	return {
		plan,
		view: buildLiveView({
			plan,
			rescues,
			facts,
			seed: {
				title: seed.title,
				date: seed.date,
				guests: seed.guests.estimate,
				serviceStyle: seed.serviceStyle,
				rescue: (seed as { rescue?: Record<string, unknown> }).rescue
			},
			rules,
			weekSpentCents: spent.ok ? spent.value.value : 0,
			previewRanking: s.preset !== 'kitchen'
		}),
		approval: current,
		lastInvalidated,
		orders,
		kitchen,
		rules,
		preset: s.preset,
		contention: s.contention,
		mandateVersion: kitchen.mandate.version,
		clock: {
			nowIso: scenarioClock(currentRunStartedAt(ctx.workspaceId)).at(Date.now()).toISOString(),
			runId: currentRun(ctx.workspaceId),
			workspaceId: ctx.workspaceId
		}
	};
}

/** Re-quotes the plan so a simulator change shows up on its lines (an edit to the same g/guest re-quotes). */
async function requote(s: Session) {
	const plan = await findPlan(s);
	if (!plan) return;
	const need = plan.needs.find(
		(n) => n.dish && !plan.lines.some((l) => l.needId === n.id && l.state === 'committed')
	);
	if (!need?.dish) return;
	await must(s, 'edit_line', {
		planId: plan.id,
		version: plan.version,
		needId: need.id,
		patch: { gramsPerGuest: need.dish.gServed }
	});
}

/**
 * "Apply these rules": for each real outage, the chef asks find_substitutes to apply the recommendation under the
 * session's preset. The core replaces the old substitute (never stacks), re-quotes and voids the approval.
 */
async function applyRules(s: Session) {
	const plan0 = await findPlan(s);
	if (!plan0) throw new Error('start the demo first');
	const b = await createServerPorts();
	const kitchens = await b.ports.store.kitchens(chef(s).workspaceId);
	const kitchen = kitchens.find((k) => k.id === s.kitchenId) ?? kitchens[0];
	const outages = plan0.lines.filter((l) => l.state === 'unorderable' && !l.substituteFor);
	for (const line of outages) {
		const plan = (await findPlan(s))!;
		await must(s, 'find_substitutes', {
			planId: plan.id,
			version: plan.version,
			lineId: line.id,
			apply: true,
			...presetInput(kitchen, s)
		});
	}
}

export function scenario(sid: string, action: string, value: unknown): Promise<LiveSnapshot> {
	return serial(() => applyScenario(session(sid), action, value));
}

async function applyScenario(s: Session, action: string, value: unknown): Promise<LiveSnapshot> {
	const b = await createServerPorts();
	if (action === 'start') {
		await ensurePlan(s);
	} else if (
		action === 'preset' &&
		(value === 'kitchen' || value === 'price' || value === 'finnish')
	)
		s.preset = value;
	else if (action === 'apply') await applyRules(s);
	else if (action === 'kitchen' && typeof value === 'string') {
		const before = { ...s };
		s.kitchenId = value;
		s.preset = 'kitchen';
		try {
			if (!(await findPlan(s))) await ensurePlan(s);
			return await buildSnapshot(s);
		} catch (e) {
			// A kitchen whose plan can't be built must not strand the screen: go back and say why.
			Object.assign(s, before);
			throw new Error(
				`could not open ${value}: ${e instanceof Error ? e.message : String(e)}; staying on ${before.kitchenId}`,
				{ cause: e }
			);
		}
	} else if (action === 'contention') {
		// The overlay is simulator state of the run (one Valio stock for every kitchen), not a view setting.
		s.contention = Boolean(value);
		b.overlay.clear();
		if (s.contention)
			b.overlay.setAvailability({
				productId: CONTENDED.productId,
				amount: CONTENDED.left,
				label: `simulated: another kitchen took 4 × ${CONTENDED.productId}`
			});
		await requote(s);
	} else if (action === 'reset') {
		// A fresh run server-side (9c): no plan, orders or spend; the old run stays in the op log.
		await resetDemoRun(s.workspaceId);
		s.kitchenId = 'k-hotel';
		s.preset = 'kitchen';
		s.contention = false;
		b.overlay.clear();
	} else throw new Error(`unknown scenario action ${action}`);
	return buildSnapshot(s);
}
