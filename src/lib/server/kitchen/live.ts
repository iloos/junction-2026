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
import type { Approval, Kitchen, Plan, ToolInput, ToolName } from '$lib/core/contracts';
import { isoWeek } from '$lib/core/mandate/tier';
import { contextFor } from '$lib/server/auth';
import { createServerPorts } from '$lib/server/store/server-ports';
import { handlers } from '$lib/server/tools/handlers';
import { serveTool, type Served } from '$lib/server/tools/serve';
import { rulesFor, type PresetId } from '$lib/kitchen/fixture-plan';
import type { CommitRecord, FixtureSnapshot, PlanOrigin } from '$lib/kitchen/fixture-server';
import { buildLiveView, type ProductFacts, type SubstitutesOut } from '$lib/kitchen/live-view';
import seed from '../../../../fixtures/seeds/christmas-buffet-140.json';
import { scenarioClock } from '$lib/core/scenario';
import { currentRun, currentRunStartedAt } from '$lib/server/demo/run';
import { reloadRunNow, resetDemoRun } from '$lib/server/demo/reset';
import { isSandbox, resetSandbox } from '$lib/server/demo/sandbox';
import { inWorkspace } from '$lib/server/adapters/simulator/overlay';
import { rescueContention } from '$lib/core/services/contention';
import { catchUp } from '$lib/server/bus';

const EVENT_ID = 'event-xmas-140';
/** The palvikinkku the ham rescue relies on (13 of 15 in stock): the contention preset takes 4 of them. */
const CONTENDED = { productId: '476768', left: 11, taken: 4 };

export interface Session {
	/** The browser's room from demo/visitor.ts: its own sandbox, a shared one, or the stage. */
	workspaceId: string;
	kitchenId: string;
	preset: PresetId;
	contention: boolean;
	/**
	 * A plan opened by link (an agent's or a menu's held plan: `/?kitchen&plan`), shown instead of the kitchen's
	 * event plan until the chef switches kitchen or starts over.
	 */
	planId: string | null;
	/** The agent's last contention rescue on the plan on screen (see FixtureSnapshot.contentionRescue). */
	contentionRescue?: FixtureSnapshot['contentionRescue'] & { planId: string };
}

/** What the page was rendered from; every command must still match it (a stale tab gets STALE_VERSION). */
export interface RenderedView {
	runId: string;
	planId: string;
	version: number;
}

/**
 * Selection per browser session (cookie id), in the workspace the visitor resolver chose for this request. A
 * browser that moves to another room starts with a fresh selection there. The simulator overlay itself is
 * per workspace (adapters/simulator/overlay.ts): see `contention`. Bounded: the oldest selections are dropped past MAX_SESSIONS.
 */
const MAX_SESSIONS = 2000;
const sessions = new Map<string, Session>();
export function session(id: string, workspaceId: string): Session {
	let s = sessions.get(id);
	if (s && s.workspaceId === workspaceId) {
		sessions.delete(id);
		sessions.set(id, s); // most recently used last
		return s;
	}
	s = { workspaceId, kitchenId: 'k-hotel', preset: 'kitchen', contention: false, planId: null };
	sessions.delete(id);
	sessions.set(id, s);
	if (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value!);
	return s;
}

/** The commands the screen may send through the helper. Planning and resets go through `scenario`. */
const ALLOWED = new Set(['get_plan', 'edit_line', 'explain_line', 'approve', 'commit_order']);

const chef = (s: Session) => contextFor('chef', 'kitchen-ui', 'kitchen', env, s.workspaceId);
const agent = (s: Session) =>
	contextFor('kitchen_agent', 'kitchen-agent', 'kitchen', env, s.workspaceId);

/**
 * One kitchen request at a time per workspace. The snapshot plans and ranks with several tool calls against
 * one plan version; a chef edit landing in between would make those calls stale, so screen requests in the
 * same workspace queue behind each other. Different sandboxes run side by side.
 */
const queues = new Map<string, Promise<unknown>>();
function serial<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
	// Inside the workspace's scope, so the simulated overlay (contention) is this sandbox's alone.
	const scoped = () => inWorkspace(workspaceId, fn);
	const next = (queues.get(workspaceId) ?? Promise.resolve()).then(scoped, scoped);
	const tail = next.catch(() => undefined);
	queues.set(workspaceId, tail);
	// Forget an idle workspace's queue once nothing is waiting behind this call.
	void tail.then(() => queues.get(workspaceId) === tail && queues.delete(workspaceId));
	return next;
}

/** One allowlisted tool call as the chef, through the shared gate, and only on this session's plan. */
export function callTool(
	sid: string,
	workspaceId: string,
	name: string,
	input: unknown,
	view: RenderedView | null
): Promise<Served> {
	return serial(workspaceId, async () => {
		const deny = (message: string): Served => ({
			ok: false,
			status: 403,
			error: { code: 'FORBIDDEN', message, retryable: false }
		});
		if (!ALLOWED.has(name)) return deny(`the kitchen screen does not send ${name}`);
		const remembered = session(sid, workspaceId);
		// The screen names the plan it shows; the command acts on that plan if this workspace has it, so it never
		// depends on this process having seen the link. A copy: one screen's command (the dock's) never moves the
		// plan another screen on this browser (the Kitchen page) reads by default.
		let s = remembered;
		const b0 = await createServerPorts();
		const ws0 = await b0.ports.store.load(chef(s).workspaceId, chef(s).runId);
		if (view && view.planId !== s.planId) {
			const named = ws0.plans[view.planId];
			if (named) s = { ...remembered, planId: named.id, kitchenId: named.kitchenId };
		}
		const plan = await findPlan(s);
		const i = (input ?? {}) as { planId?: string; approvalId?: string };
		if (!plan) return deny('start the demo first');
		// The page must still show what the server has: same run, same plan, same version. A tab left open across
		// a start-over or another tab's edit would otherwise act on a plan its chef never saw.
		const stale = (message: string): Served => ({
			ok: false,
			status: 409,
			error: { code: 'STALE_VERSION', message, retryable: false }
		});
		if (!view) return stale('This page did not say which plan it shows. Reload the page.');
		if (view.runId !== currentRun(s.workspaceId))
			return stale('This page is out of date: the sandbox was started over. Reload the page.');
		if (view.planId !== plan.id || view.version !== plan.version)
			return stale(
				`This page is out of date: the plan is now version ${plan.version}. Reload the page.`
			);
		if (i.planId !== undefined && i.planId !== plan.id)
			return deny("that plan is not this session's kitchen plan");
		// The approval must exist and belong to the plan on screen: an exact check, not a match on its id's text.
		if (name === 'approve' && ws0.approvals[i.approvalId ?? '']?.planId !== plan.id)
			return deny("that approval is not for this session's plan");
		return serveTool(name, chef(s), input, handlers);
	});
}

/** The plan opened by link if any, else the session kitchen's event plan if it exists: a read, never planning. */
async function findPlan(s: Session) {
	const ctx = chef(s);
	const b = await createServerPorts();
	const ws = await b.ports.store.load(ctx.workspaceId, ctx.runId);
	const linked = s.planId ? ws.plans[s.planId] : undefined;
	if (linked && linked.kitchenId === s.kitchenId) return linked;
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
/** The first half of `start`: plan the event (menu × guests → needs → lines). Idempotent. */
async function planOnly(s: Session) {
	const { plan } = (await must(s, 'plan_event', {
		kitchenId: s.kitchenId,
		eventId: EVENT_ID
	})) as PlanOut;
	return plan;
}

/** Counts for the start screen's progress: real numbers from the plan just made. */
export interface PlanProgress {
	planned: true;
	dishes: number;
	lines: number;
	outages: number;
}

async function ensurePlan(s: Session) {
	let plan = await planOnly(s);
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

export function snapshot(sid: string, workspaceId: string): Promise<LiveSnapshot> {
	return serial(workspaceId, () => buildSnapshot(session(sid, workspaceId)));
}

/**
 * Opens a plan by id (an approval link from MCP, chat or Ops) in this browser's workspace: the session switches
 * to its kitchen and shows it, with its decisions. Null when this workspace has no such plan.
 */
export function focusPlan(
	sid: string,
	workspaceId: string,
	planId: string,
	/** Read that plan without making it this browser's remembered plan (the dock's own view of another plan). */
	peek = false
): Promise<LiveSnapshot | null> {
	return serial(workspaceId, async () => {
		const remembered = session(sid, workspaceId);
		const s = peek ? { ...remembered } : remembered;
		const b = await createServerPorts();
		const find = async () => {
			const ctx = chef(s);
			return (await b.ports.store.load(ctx.workspaceId, ctx.runId)).plans[planId];
		};
		// A link can name a plan written on a run this process hasn't caught up with yet (a new sandbox, another
		// instance): re-read the current run once before saying the plan isn't here.
		let plan = await find();
		if (!plan) {
			await reloadRunNow(workspaceId);
			plan = await find();
		}
		if (!plan) return null;
		s.kitchenId = plan.kitchenId;
		s.planId = plan.id;
		return buildSnapshot(s);
	});
}

/**
 * Who last changed each line of a plan, from this run's op log: a substitute proposed, a line edited, or an outside
 * agent's order created. Only agent authors are returned; a chef's own edit clears the mark.
 */
async function planHistory(
	workspaceId: string,
	runId: string,
	planId: string
): Promise<{
	byAgent: Record<string, 'kitchen_agent' | 'external_agent'>;
	origin: PlanOrigin | null;
}> {
	const last = new Map<string, string>();
	let origin: PlanOrigin | null = null;
	try {
		for (const e of await catchUp(workspaceId, 0, 5000, runId)) {
			if (e.kind !== 'op') continue;
			const { op, actor, via } = e.envelope;
			if (op.type === 'CreatePlan' && op.plan.id === planId)
				origin = originOf(actor.kind, via, op.plan);
			const ids =
				op.type === 'ProposeSubstitute' && op.planId === planId
					? op.lines.map((l) => l.id)
					: op.type === 'EditLine' && op.planId === planId
						? op.lines.filter((l) => l.line).map((l) => l.lineId)
						: op.type === 'CreatePlan' && op.plan.id === planId && actor.kind === 'external_agent'
							? op.plan.lines.map((l) => l.id)
							: [];
			for (const id of ids) last.set(id, actor.kind);
		}
	} catch {
		// The marks and the origin are a courtesy: a log that can't be read never breaks the screen.
		return { byAgent: {}, origin: null };
	}
	return {
		byAgent: Object.fromEntries(
			[...last].filter(([, k]) => k === 'kitchen_agent' || k === 'external_agent')
		) as Record<string, 'kitchen_agent' | 'external_agent'>,
		origin
	};
}

/** Where a plan came from, from its CreatePlan op: the booking, the agent in chat, a request, an outside agent. */
function originOf(actor: string, via: string, plan: Plan): PlanOrigin {
	if (plan.eventId) return 'event';
	if (actor === 'external_agent' || via.startsWith('mcp') || via.startsWith('rest'))
		return 'outside_agent';
	if (via.startsWith('request')) return 'request';
	if (via.startsWith('chat') || via.startsWith('task') || actor === 'kitchen_agent') return 'chat';
	return 'kitchen';
}

/** A plan that is not the seeded event (an agent's order, a menu): named by what it buys. */
function titleOf(plan: Plan): string {
	const labels = plan.needs.map((n) => n.label);
	// An order of loose lines (an outside agent's place_order): named by what it buys.
	if (!labels.length) {
		const bought = plan.lines
			.filter((l) => l.qty.value > 0)
			.map((l) => `${l.qty.value} ${l.qty.unit} ${l.productName ?? l.productId}`);
		if (!bought.length) return 'Order';
		return bought.length <= 2
			? bought.join(', ')
			: `${bought.slice(0, 2).join(', ')} and ${bought.length - 2} more`;
	}
	return labels.length <= 3
		? labels.join(', ')
		: `${labels.slice(0, 3).join(', ')} and ${labels.length - 3} more`;
}

async function buildSnapshot(s: Session): Promise<LiveSnapshot> {
	const ctx = chef(s);
	const planned = await findPlan(s);
	if (!planned) return { started: false, kitchenId: s.kitchenId };
	const b = await createServerPorts();
	const kitchens = await b.ports.store.kitchens(ctx.workspaceId);
	const kitchen = kitchens.find((k) => k.id === s.kitchenId) ?? kitchens[0];
	const { plan, approval: gpApproval } = (await must(s, 'get_plan', {
		planId: planned.id
	})) as PlanOut & { approval: { id: string; state: Approval['state'] } | null };

	// Rankings under the active rules preset (previews: nothing is persisted).
	// Previews write nothing, so they run side by side.
	const outages = plan.lines.filter((x) => x.state === 'unorderable' && !x.substituteFor);
	const previews = await Promise.all(
		outages.map(
			(l) =>
				must(s, 'find_substitutes', {
					planId: plan.id,
					version: plan.version,
					lineId: l.id,
					...presetInput(kitchen, s)
				}) as Promise<SubstitutesOut>
		)
	);
	const rescues: Record<string, SubstitutesOut> = Object.fromEntries(
		outages.map((l, i) => [l.id, previews[i]])
	);

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
	const shortNames: Record<string, string> = {};
	for (const [id, p] of products) if (p.nameShort?.value) shortNames[id] = p.nameShort.value;
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
	// The plan's current approval is the one get_plan names (core's rule), with its state as get_plan reports it.
	const named = gpApproval ? approvals.find((a) => a.id === gpApproval.id) : undefined;
	const current: Approval | null = named
		? { ...named, state: gpApproval!.state }
		: (approvals
				.filter((a) => a.state === 'pending' || a.state === 'granted')
				.sort((a, b) => b.planVersion - a.planVersion)[0] ?? null);
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
				at: o.committedAt,
				key: o.idempotencyKey
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
	const { byAgent, origin } = await planHistory(ctx.workspaceId, ctx.runId, plan.id);
	const others = Object.values(ws.plans)
		.filter((p) => p.kitchenId === kitchen.id && p.id !== plan.id && p.lines.length > 0)
		.map((p) => ({
			id: p.id,
			title: p.eventId === EVENT_ID ? seed.title : titleOf(p),
			open: p.lines.filter((l) => !['committed', 'rejected', 'unorderable'].includes(l.state))
				.length,
			ordered: p.lines.filter((l) => l.state === 'committed').length
		}))
		.slice(-6);
	return {
		others,
		plan,
		view: buildLiveView({
			plan,
			rescues,
			facts,
			seed:
				plan.eventId === EVENT_ID
					? {
							title: seed.title,
							date: seed.date,
							guests: seed.guests.estimate,
							serviceStyle: seed.serviceStyle,
							rescue: (seed as { rescue?: Record<string, unknown> }).rescue
						}
					: { title: titleOf(plan), date: plan.deliverBy, guests: 0, serviceStyle: '' },
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
		byAgent,
		origin: origin ?? (plan.eventId ? 'event' : null),
		shortNames,
		contentionRescue:
			s.contentionRescue?.planId === plan.id
				? {
						productName: s.contentionRescue.productName,
						taken: s.contentionRescue.taken,
						had: s.contentionRescue.had,
						left: s.contentionRescue.left,
						unit: s.contentionRescue.unit,
						added: s.contentionRescue.added,
						signOff: s.contentionRescue.signOff
					}
				: null,
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

/** The sandbox was just started over by someone; the reset can run again after `retryInMs`. */
export class Cooldown extends Error {
	constructor(public retryInMs: number) {
		super(`The sandbox was just started over. Try again in ${Math.ceil(retryInMs / 1000)} s.`);
	}
}

export function scenario(
	sid: string,
	workspaceId: string,
	action: string,
	value: unknown,
	/** The plan the screen shows: the command acts on it, not on whatever this browser's session last opened. */
	planId?: string
): Promise<LiveSnapshot | PlanProgress> {
	return serial(workspaceId, async () => {
		const s = session(sid, workspaceId);
		if (planId && ON_PLAN.has(action)) {
			const b = await createServerPorts();
			const ctx = chef(s);
			const plan = (await b.ports.store.load(ctx.workspaceId, ctx.runId)).plans[planId];
			if (plan) {
				s.kitchenId = plan.kitchenId;
				s.planId = plan.id;
			}
		}
		return applyScenario(s, action, value);
	});
}
/** Commands about the plan on screen; starting, switching kitchen and resetting choose their own plan. */
const ON_PLAN = new Set(['preset', 'apply', 'contention']);

async function applyScenario(
	s: Session,
	action: string,
	value: unknown
): Promise<LiveSnapshot | PlanProgress> {
	const b = await createServerPorts();
	if (action === 'start') {
		await ensurePlan(s);
	} else if (action === 'plan') {
		// Step 1 of 2 of a visible start: the plan only, answered with counts (no snapshot, so it is quick).
		const plan = await planOnly(s);
		return {
			planned: true,
			dishes: plan.needs.length,
			lines: plan.lines.length,
			outages: plan.lines.filter((l) => l.state === 'unorderable' && !l.substituteFor).length
		};
	} else if (action === 'rescue') {
		// Step 2 of 2: the kitchen agent proposes rescues; answered with the full snapshot.
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
		s.planId = null;
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
		// The overlay is simulator state of this workspace (one Valio stock for every kitchen in it), not a
		// view setting; other sandboxes never see it.
		s.contention = Boolean(value);
		b.overlay.clear();
		if (s.contention)
			b.overlay.setAvailability({
				productId: CONTENDED.productId,
				amount: CONTENDED.left,
				label: `simulated: another kitchen took ${CONTENDED.taken} × ${CONTENDED.productId}`
			});
		s.contentionRescue = undefined;
		if (s.contention) {
			// The kitchen agent repairs every live plan counting on the product: keeps what is left, sizes the next
			// candidate to the rest, voids any approval it touches. Nothing is ordered; a person still decides.
			const r = await inWorkspace(s.workspaceId, () =>
				rescueContention(b.ports, agent(s), {
					productId: CONTENDED.productId,
					note: `another kitchen took ${CONTENDED.taken} × ${CONTENDED.productId}`,
					ref: 'sim:contention'
				})
			);
			if (!r.ok) throw new Error(`contention rescue: ${r.error.code} ${r.error.message}`);
			const onScreen = await findPlan(s);
			const mine = r.value.rescued.find((x) => x.planId === onScreen?.id);
			if (mine) {
				const was = mine.plan.lines.find((l) => l.id === mine.lineId);
				const added = mine.chosen.filter((l) => l.productId !== CONTENDED.productId);
				s.contentionRescue = {
					planId: mine.planId,
					productName: was?.productName ?? CONTENDED.productId,
					taken: CONTENDED.taken,
					had: mine.had,
					left: mine.left,
					unit: was?.qty.unit ?? 'ST',
					added: added.map((l) => ({
						name: l.productName ?? l.productId,
						qty: l.qty.value,
						unit: l.qty.unit,
						physical: l.view?.physical ? `${l.view.physical.value} ${l.view.physical.unit}` : null
					})),
					signOff: added.some((l) => l.tier === 'sign_off')
				};
			}
		} else await requote(s);
	} else if (action === 'reset') {
		// A fresh run server-side: no plan, orders or spend; the old run stays in the op log. Sandboxes go
		// through the self-service reset (cooldown per sandbox); the stage only reaches here for a presenter.
		if (isSandbox(s.workspaceId)) {
			const r = await resetSandbox(s.workspaceId);
			if (!r.ok && 'retryInMs' in r) throw new Cooldown(r.retryInMs);
		} else await resetDemoRun(s.workspaceId);
		s.kitchenId = 'k-hotel';
		s.planId = null;
		s.preset = 'kitchen';
		s.contention = false;
		b.overlay.clear();
	} else throw new Error(`unknown scenario action ${action}`);
	return buildSnapshot(s);
}
