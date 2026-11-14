/**
 * The request a piece of server work belongs to, carried through async code like the external scope
 * (external/scope.ts): hooks.server.ts opens it per request, tool calls and call scopes fill in the workspace,
 * run and actor, and the logger and trace writer read it. Nothing passes it as an argument.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export interface RequestContext {
	requestId: string;
	method?: string;
	route?: string;
	workspaceId?: string;
	runId?: string;
	actor?: { kind: string; id: string };
	via?: string;
}

const als = new AsyncLocalStorage<RequestContext>();

/** An incoming x-request-id is kept when it is short and plain; anything else gets a fresh id. */
const REQUEST_ID_RE = /^[\w.:-]{1,64}$/;

export function requestIdFrom(incoming: string | null | undefined): string {
	return incoming && REQUEST_ID_RE.test(incoming) ? incoming : `req-${randomUUID().slice(0, 18)}`;
}

export function withRequest<T>(ctx: RequestContext, fn: () => T): T {
	return als.run(ctx, fn);
}

export function currentRequest(): RequestContext | undefined {
	return als.getStore();
}

/**
 * Adds what a later layer learns (the workspace a tool call resolved to, its actor) to the open request. The first
 * value wins for the workspace and actor, so an agent run started by the request keeps its starter's.
 */
export function annotateRequest(more: Omit<Partial<RequestContext>, 'requestId'>): void {
	const r = als.getStore();
	if (!r) return;
	for (const [k, v] of Object.entries(more) as [keyof RequestContext, never][])
		if (v !== undefined && r[k] === undefined) r[k] = v;
}

/**
 * An outside call (external/call.ts) that wraps an adapter which traces itself: the inner adapter's line is kept
 * for the console but not stored, so one Gemini call is one row.
 */
const outer = new AsyncLocalStorage<true>();
export function withinOuterTrace<T>(fn: () => T): T {
	return outer.run(true, fn);
}
export const insideOuterTrace = (): boolean => outer.getStore() === true;
