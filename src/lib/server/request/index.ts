/**
 * Server wiring for the request flow: the process-wide handlers and store, the simulator clock,
 * the configured Llm (traced to the ops bus), and the three in-process actors the /request page
 * uses. Keys never reach the browser: the page acts through these contexts server-side.
 *
 * Which workspace the key-less page acts in is decided by `visitorWorkspace` (server/demo/visitor),
 * never by the request: the visitor's own sandbox, a shared room, or the stage run for the presenter.
 * Callers without a workspace (tests, scripts) act in the judges' shared room.
 */
import type { Kitchen } from '$lib/core/contracts';
import type { CallContext } from '$lib/core/ports';
import { createDecide } from '$lib/server/adapters/decide';
import { createLlmRouter } from '$lib/server/adapters/llm/router';
import { traceEvent, type Trace } from '$lib/server/adapters/llm/trace';
import { reviewEnabled, ReviewBudget, type ReviewDeps } from '$lib/server/review';
import { contextFor, JUDGES_WORKSPACE, type Env } from '$lib/server/auth';
import { publish } from '$lib/server/bus';
import { createServerPorts } from '$lib/server/store/server-ports';
import { handlers, realHandlers } from '$lib/server/tools/handlers';
import type {
	ApprovalView,
	BriefAnswer,
	CommitView,
	RequestAnswer,
	RequestEvent,
	RequestResult
} from '$lib/ui/request/types';
import { scenarioDate } from '$lib/core/scenario';
import { inWorkspace } from '$lib/server/adapters/simulator/overlay';
import { ensureRunLoaded } from '$lib/server/demo/reset';
import { approvalView, callTool, runRequest, type RequestDeps } from './run';
import type { ParsedRequest } from './parse';
import type { RankBy } from './rank-by';

export { ToolFailed } from './run';
import { ToolFailed } from './run';
import { canonicalJson, sha256Hex } from '$lib/core/hash';
export { readBriefAnswers } from '$lib/server/menu/brief';
export { readAnswers } from './workspace';

export const DEFAULT_KITCHEN = 'k-hotel';

/**
 * The page's actors in one workspace: the kitchen agent places, the head chef approves (approver),
 * the chef commits. The workspace is created on first use (seed kitchens) before its run is read.
 */
export async function actors(env: Env, workspaceId: string) {
	await (await ports()).store.kitchens(workspaceId);
	return {
		agent: contextFor('kitchen_agent', 'request-agent', 'request', env, workspaceId),
		approver: contextFor('approver', 'head-chef', 'request', env, workspaceId),
		chef: contextFor('chef', 'chef', 'request', env, workspaceId)
	};
}

/** Ports built once per process; handlers first so the store is wired to the ops bus. */
export async function ports() {
	await realHandlers();
	return createServerPorts();
}

/**
 * Run with the workspace's own scenario clock: the shared ports read the clock of the call's workspace scope, and
 * a workspace whose run this process hasn't loaded would tick from process start instead of its run's start.
 */
export async function inScope<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
	await ensureRunLoaded(workspaceId);
	return inWorkspace(workspaceId, fn);
}

/** The scenario clock's instant (ISO) in a workspace, for comparing cut-offs on the page. */
export async function simNow(workspaceId: string): Promise<string> {
	return inScope(workspaceId, async () => (await ports()).ports.clock.now().toISOString());
}

export async function simToday(workspaceId: string): Promise<string> {
	return inScope(workspaceId, async () => scenarioDate((await ports()).ports.clock.now()));
}

export async function kitchens(ctx: CallContext): Promise<Kitchen[]> {
	return (await ports()).store.kitchens(ctx.workspaceId);
}

export function llmKind(env: Env): ParsedRequest['parser']['kind'] {
	const p = env.LLM_PROVIDER ?? 'fixture';
	if (p === 'gemini' && (env.GEMINI_STUDIO_API_KEY || env.GEMINI_API_KEY)) return 'gemini';
	if (p === 'featherless' && env.FEATHERLESS_API_KEY) return 'featherless';
	return 'fixture';
}

/** A request runs in its caller's workspace: its clock, run and plans, never another room's. */
export async function submitRequest(o: SubmitOptions): Promise<RequestResult> {
	const ctx = o.ctx ?? (await actors(o.env, o.workspaceId ?? JUDGES_WORKSPACE)).agent;
	return inScope(ctx.workspaceId, () => submitInScope({ ...o, ctx }));
}

type SubmitOptions = {
	text: string;
	kitchenId?: string;
	nonce?: string;
	place?: boolean;
	answers?: RequestAnswer[];
	briefAnswers?: BriefAnswer[];
	confirmLarge?: boolean;
	/** The chef's chosen delivery date (a cut-off answer). */
	deliverBy?: string;
	/** A per-request ranking preference (Rank by). */
	rankBy?: RankBy;
	/** A dish request's choice (ready-made or from raw), edited portions, or "packs, not portions". */
	dish?: RequestDeps['dish'];
	/** Items the chef edited in place: the words are not read again. */
	items?: RequestDeps['items'];
	env: Env;
	/** The page passes its workspace; the API passes the key's context instead. */
	workspaceId?: string;
	ctx?: CallContext;
	onEvent?: (e: RequestEvent) => void;
};

async function submitInScope(o: SubmitOptions): Promise<RequestResult> {
	const ctx = o.ctx ?? (await actors(o.env, o.workspaceId ?? JUDGES_WORKSPACE)).agent;
	const all = await kitchens(ctx);
	const kitchen = all.find((k) => k.id === (o.kitchenId || DEFAULT_KITCHEN));
	if (!kitchen) throw new Error(`unknown kitchen ${o.kitchenId}`);
	const kind = llmKind(o.env);
	const trace: Trace = (step, data) =>
		void publish(ctx.workspaceId, [
			traceEvent(ctx, step, { actor: ctx.actor.id, purpose: 'request.parse', ...data })
		]);
	const llm = kind === 'fixture' ? null : createLlmRouter(o.env, trace).for('request.parse');
	// Shipped dark: REVIEW=1 reviews the parse (model scoring only when Decide is live).
	const review: ReviewDeps | undefined = reviewEnabled(o.env)
		? {
				decide: createDecide({
					env: o.env,
					trace,
					replayPath: 'src/lib/server/adapters/decide/replay.json'
				}),
				trace,
				budget: new ReviewBudget(2)
			}
		: undefined;
	return runRequest(o.text, {
		handlers,
		ctx,
		today: await simToday(ctx.workspaceId),
		kitchen,
		llm,
		llmKind: kind,
		nonce: o.nonce,
		place: o.place,
		answers: o.answers,
		briefAnswers: o.briefAnswers,
		confirmLarge: o.confirmLarge,
		deliverBy: o.deliverBy,
		rankBy: o.rankBy,
		dish: o.dish,
		items: o.items,
		clock: (await ports()).ports.clock,
		tasks: (await ports()).ports.tasks,
		onEvent: o.onEvent,
		review
	});
}

export async function approveRequest(o: {
	env: Env;
	workspaceId: string;
	approvalId: string;
	planId: string;
	planVersion: number;
	termsHash: string;
	decision: 'grant' | 'deny';
}) {
	const a = await actors(o.env, o.workspaceId);
	const r = await callTool(handlers, a.approver, 'approve', {
		approvalId: o.approvalId,
		planVersion: o.planVersion,
		termsHash: o.termsHash,
		decision: o.decision
	});
	const view = await approvalView(handlers, a.chef, o.planId);
	return { state: r.state, ...view };
}

/**
 * The lines a commit from Request means now: every eligible line plus every open line a granted approval covers
 * (what commit_order commits by default), named exactly.
 */
export function committableLines(
	plan: { lines: { id: string; state: string }[] },
	approval: { state: string; lineIds: string[] } | null
): string[] {
	const granted = approval?.state === 'granted' ? new Set(approval.lineIds) : new Set<string>();
	const open = new Set(['proposed', 'eligible', 'held']);
	return plan.lines
		.filter((l) => l.state === 'eligible' || (granted.has(l.id) && open.has(l.state)))
		.map((l) => l.id)
		.sort();
}

/**
 * The one command identity for a commit from Request: plan, version, accepted terms and the exact lines. A transport
 * retry (same lines) is the same key and replays the receipt; a remainder approved later is a new command. Swapped
 * for core's commandKey (D18) when it lands, here only.
 */
export async function commitKey(
	planId: string,
	version: number,
	termsHash: string | null,
	lineIds: readonly string[]
): Promise<string> {
	const h = await sha256Hex(
		canonicalJson({ planId, version, termsHash, lineIds: [...lineIds].sort() })
	);
	return `rq-commit-${h.slice(0, 24)}`;
}

export async function commitRequest(o: {
	env: Env;
	workspaceId: string;
	planId: string;
	version: number;
	attempt: number;
	/** A retry of an earlier commit: its exact lines, so the key and the receipt are the same. */
	lineIds?: string[];
}): Promise<{
	commit: CommitView;
	plan: Awaited<ReturnType<typeof approvalView>>['plan'];
	approval: ApprovalView | null;
}> {
	const a = await actors(o.env, o.workspaceId);
	const before = await approvalView(handlers, a.chef, o.planId);
	const lineIds = o.lineIds?.length
		? [...o.lineIds]
		: committableLines(before.plan, before.approval);
	if (!lineIds.length)
		throw new ToolFailed('commit_order', 'FORBIDDEN', 'no line can be committed now');
	const idempotencyKey = await commitKey(o.planId, o.version, before.plan.termsHash, lineIds);
	const r = await callTool(handlers, a.chef, 'commit_order', {
		planId: o.planId,
		version: o.version,
		idempotencyKey,
		lineIds
	});
	const view = await approvalView(handlers, a.chef, o.planId);
	return {
		commit: { ...r, idempotencyKey, version: o.version, attempt: o.attempt, lineIds },
		...view
	};
}
