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
import { approvalView, callTool, runRequest } from './run';
import type { ParsedRequest } from './parse';

export { ToolFailed } from './run';
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

/** The commit key is derived from the plan version, so a retry (or a double click) is the same commit. */
export function commitKey(planId: string, version: number): string {
	return `rq-commit-${planId}-v${version}`;
}

export async function commitRequest(o: {
	env: Env;
	workspaceId: string;
	planId: string;
	version: number;
	attempt: number;
}): Promise<{
	commit: CommitView;
	plan: Awaited<ReturnType<typeof approvalView>>['plan'];
	approval: ApprovalView | null;
}> {
	const a = await actors(o.env, o.workspaceId);
	const idempotencyKey = commitKey(o.planId, o.version);
	const r = await callTool(handlers, a.chef, 'commit_order', {
		planId: o.planId,
		version: o.version,
		idempotencyKey
	});
	const view = await approvalView(handlers, a.chef, o.planId);
	return { commit: { ...r, idempotencyKey, version: o.version, attempt: o.attempt }, ...view };
}
