/**
 * Server wiring for the request flow: the process-wide handlers and store, the simulator clock,
 * the configured Llm (traced to the ops bus), and the three in-process actors the /request page
 * uses. Keys never reach the browser: the page acts through these contexts server-side.
 */
import type { Kitchen } from '$lib/core/contracts';
import type { CallContext } from '$lib/core/ports';
import { createLlm } from '$lib/server/adapters/llm';
import { traceEvent } from '$lib/server/adapters/llm/trace';
import { contextFor, type Env } from '$lib/server/auth';
import { publish } from '$lib/server/bus';
import { createServerPorts } from '$lib/server/store/server-ports';
import { handlers, realHandlers } from '$lib/server/tools/handlers';
import type { ApprovalView, CommitView, RequestEvent, RequestResult } from '$lib/ui/request/types';
import { helsinkiDate } from './dates';
import { approvalView, callTool, runRequest, type ApprovalRecord } from './run';
import type { ParsedRequest } from './parse';

export { ToolFailed } from './run';

export const DEFAULT_KITCHEN = 'k-hotel';

/** The page's actors: the kitchen agent places, the head chef approves (approver key), the chef commits. */
export function actors(env: Env) {
	return {
		agent: contextFor('kitchen_agent', 'request-agent', 'request', env),
		approver: contextFor('approver', 'head-chef', 'request', env),
		chef: contextFor('chef', 'chef', 'request', env)
	};
}

/** Ports built once per process; handlers first so the store is wired to the ops bus. */
async function ports() {
	await realHandlers();
	return createServerPorts();
}

export async function simToday(): Promise<string> {
	return helsinkiDate((await ports()).ports.clock.now());
}

export async function kitchens(ctx: CallContext): Promise<Kitchen[]> {
	return (await ports()).store.kitchens(ctx.workspaceId);
}

/** Approval fields get_plan does not return (Need: add them to the get_plan contract). Read-only. */
function approvalRecord(ctx: CallContext) {
	return async (id: string): Promise<ApprovalRecord | null> => {
		const b = await ports();
		const st = await b.store.load(ctx.workspaceId, ctx.runId);
		const a = st.approvals[id];
		return a
			? {
					mandateVersion: a.mandateVersion,
					expiresAt: a.expiresAt,
					requestedBy: `${a.requestedBy.kind}:${a.requestedBy.id}`,
					decidedBy: a.decidedBy ? `${a.decidedBy.kind}:${a.decidedBy.id}` : undefined
				}
			: null;
	};
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
	env: Env;
	ctx?: CallContext;
	onEvent?: (e: RequestEvent) => void;
}): Promise<RequestResult> {
	const ctx = o.ctx ?? actors(o.env).agent;
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
		approvalRecord: approvalRecord(ctx),
		onEvent: o.onEvent
	});
}

export async function approveRequest(o: {
	env: Env;
	approvalId: string;
	planId: string;
	planVersion: number;
	termsHash: string;
	decision: 'grant' | 'deny';
}) {
	const a = actors(o.env);
	const r = await callTool(handlers, a.approver, 'approve', {
		approvalId: o.approvalId,
		planVersion: o.planVersion,
		termsHash: o.termsHash,
		decision: o.decision
	});
	const view = await approvalView(handlers, a.chef, o.planId, approvalRecord(a.chef));
	return { state: r.state, ...view };
}

/** The commit key is derived from the plan version, so a retry (or a double click) is the same commit. */
export function commitKey(planId: string, version: number): string {
	return `rq-commit-${planId}-v${version}`;
}

export async function commitRequest(o: {
	env: Env;
	planId: string;
	version: number;
	attempt: number;
}): Promise<{
	commit: CommitView;
	plan: Awaited<ReturnType<typeof approvalView>>['plan'];
	approval: ApprovalView | null;
}> {
	const a = actors(o.env);
	const idempotencyKey = commitKey(o.planId, o.version);
	const r = await callTool(handlers, a.chef, 'commit_order', {
		planId: o.planId,
		version: o.version,
		idempotencyKey
	});
	const view = await approvalView(handlers, a.chef, o.planId, approvalRecord(a.chef));
	return { commit: { ...r, idempotencyKey, attempt: o.attempt }, ...view };
}
