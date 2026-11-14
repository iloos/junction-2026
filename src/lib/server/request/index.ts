/**
 * Server wiring for the request flow: the process-wide handlers and store, the simulator clock,
 * the configured Llm (traced to the ops bus), and the three in-process actors the /request page
 * uses. Keys never reach the browser: the page acts through these contexts server-side.
 *
 * Which workspace the key-less page acts in is decided here, never by the request: the stage run
 * (ws-demo) only when presenter actions are open (dev, or DEMO_RESET_OPEN=1, as on /ops); every
 * other visitor gets the judges' sandbox, where the whole flow, approvals included, is safe to try.
 */
import type { Kitchen } from '$lib/core/contracts';
import type { CallContext } from '$lib/core/ports';
import { createLlm } from '$lib/server/adapters/llm';
import { traceEvent } from '$lib/server/adapters/llm/trace';
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
import { helsinkiDate } from './dates';
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
async function ports() {
	await realHandlers();
	return createServerPorts();
}

/** The scenario clock's instant (ISO), for comparing cut-offs on the page. */
export async function simNow(): Promise<string> {
	return (await ports()).ports.clock.now().toISOString();
}

export async function simToday(): Promise<string> {
	return helsinkiDate((await ports()).ports.clock.now());
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

export async function submitRequest(o: {
	text: string;
	kitchenId?: string;
	nonce?: string;
	place?: boolean;
	answers?: RequestAnswer[];
	briefAnswers?: BriefAnswer[];
	confirmLarge?: boolean;
	env: Env;
	/** The page passes its workspace; the API passes the key's context instead. */
	workspaceId?: string;
	ctx?: CallContext;
	onEvent?: (e: RequestEvent) => void;
}): Promise<RequestResult> {
	const ctx = o.ctx ?? (await actors(o.env, o.workspaceId ?? JUDGES_WORKSPACE)).agent;
	const all = await kitchens(ctx);
	const kitchen = all.find((k) => k.id === (o.kitchenId || DEFAULT_KITCHEN));
	if (!kitchen) throw new Error(`unknown kitchen ${o.kitchenId}`);
	const kind = llmKind(o.env);
	const llm =
		kind === 'fixture'
			? null
			: createLlm(
					o.env,
					(step, data) =>
						void publish(ctx.workspaceId, [
							traceEvent(ctx, step, { actor: ctx.actor.id, purpose: 'request.parse', ...data })
						])
				);
	return runRequest(o.text, {
		handlers,
		ctx,
		today: await simToday(),
		kitchen,
		llm,
		llmKind: kind,
		nonce: o.nonce,
		place: o.place,
		answers: o.answers,
		briefAnswers: o.briefAnswers,
		confirmLarge: o.confirmLarge,
		onEvent: o.onEvent
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
	return { commit: { ...r, idempotencyKey, attempt: o.attempt }, ...view };
}
