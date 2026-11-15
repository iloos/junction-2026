/**
 * The read side of the stored traces, for /api/ops/traces and its summary: query parsing, who may read which
 * workspace (the same rule as /api/events), and the row → view mapping. Routes stay thin.
 */
import type { Cookies } from '@sveltejs/kit';
import type { ServerEvent } from '$lib/core/contracts';
import { isPresenter } from '../demo/presenter';
import { mayRead, ownWorkspace } from '../demo/visitor';
import { DEMO_WORKSPACE } from '../demo/workspaces';
import type { StoredTrace, TraceFilter } from './trace-store';

type Env = Record<string, string | undefined>;

export interface TraceView {
	id: string;
	at: string;
	requestId: string | null;
	workspaceId: string | null;
	runId: string | null;
	actor: { kind: string; id: string } | null;
	via: string | null;
	step: string;
	source: string;
	model: string | null;
	tool: string | null;
	tokensIn: number | null;
	tokensOut: number | null;
	latencyMs: number | null;
	cache: string | null;
	ok: boolean;
	error: string | null;
	costUnits: number | null;
	data: Record<string, unknown> | null;
}

const REL = /^(\d{1,4})(m|h|d)$/;
const UNIT_MS = { m: 60_000, h: 3_600_000, d: 86_400_000 } as const;
const PLAIN = /^[\w.:-]{1,64}$/;

/** `since`: an ISO time or a relative `15m` / `2h` / `1d`; default one hour; never older than the retention. */
export function parseSince(v: string | null, now: Date): string {
	const m = v ? REL.exec(v) : null;
	let t = m
		? now.getTime() - Number(m[1]) * UNIT_MS[m[2] as keyof typeof UNIT_MS]
		: v
			? Date.parse(v)
			: NaN;
	if (!Number.isFinite(t)) t = now.getTime() - UNIT_MS.h;
	return new Date(Math.max(t, now.getTime() - 7 * UNIT_MS.d)).toISOString();
}

export type ReadAccess =
	{ ok: true; filter: TraceFilter } | { ok: false; status: 400 | 403; message: string };

/**
 * Filters from the query, and whether this browser may read them. Production: a public room or the browser's own
 * sandbox (`mayRead`), or any workspace for the presenter; without `ws` the presenter reads every workspace and a
 * visitor their own room. Dev reads anything.
 */
export function readAccess(
	url: URL,
	cookies: Cookies,
	env: Env,
	dev: boolean,
	now = new Date()
): ReadAccess {
	const q = url.searchParams;
	const ws = q.get('ws') || q.get('workspace') || undefined;
	const requestId = q.get('requestId') || undefined;
	const runId = q.get('run') || undefined;
	const source = q.get('source') || undefined;
	for (const [k, v] of [
		['ws', ws],
		['requestId', requestId],
		['run', runId],
		['source', source]
	] as const)
		if (v && !PLAIN.test(v)) return { ok: false, status: 400, message: `bad ${k}` };
	const limit = Number(q.get('limit')) || undefined;
	const filter: TraceFilter = {
		since: parseSince(q.get('since'), now),
		requestId,
		runId,
		source,
		limit
	};
	const all = dev || isPresenter(cookies, env, dev);
	if (ws) {
		if (!all && !mayRead(ws, cookies, env))
			return { ok: false, status: 403, message: 'unknown workspace' };
		return { ok: true, filter: { ...filter, workspaceId: ws } };
	}
	if (all) return { ok: true, filter };
	return {
		ok: true,
		filter: { ...filter, workspaceId: ownWorkspace(cookies, env) ?? DEMO_WORKSPACE }
	};
}

export function toView(r: StoredTrace): TraceView {
	return {
		id: r.id,
		at: new Date(r.at).toISOString(),
		requestId: r.requestId,
		workspaceId: r.workspaceId,
		runId: r.runId,
		actor: r.actorKind && r.actorId ? { kind: r.actorKind, id: r.actorId } : null,
		via: r.via,
		step: r.step,
		source: r.source,
		model: r.model,
		tool: r.tool,
		tokensIn: r.tokensIn,
		tokensOut: r.tokensOut,
		latencyMs: r.latencyMs,
		cache: r.cache,
		ok: r.ok,
		error: r.error,
		costUnits: r.costUnits == null ? null : Number(r.costUnits),
		data: (r.data as Record<string, unknown> | null) ?? null
	};
}

const STEPS = new Set(['step', 'text', 'tool', 'decision', 'done', 'error']);

/** A stored row as the `trace` ServerEvent the drawer already renders (oldest first when the caller sorts). */
export function toTraceEvent(v: TraceView): Extract<ServerEvent, { kind: 'trace' }> {
	const { data, step, at, workspaceId, runId, actor, ...cols } = v;
	return {
		kind: 'trace',
		workspaceId: workspaceId ?? '',
		runId: runId ?? '',
		at,
		step: (STEPS.has(step) ? step : 'step') as Extract<ServerEvent, { kind: 'trace' }>['step'],
		data: {
			...(data ?? {}),
			...Object.fromEntries(Object.entries(cols).filter(([, x]) => x !== null)),
			...(actor ? { actor: actor.id, actorKind: actor.kind } : {}),
			persisted: true
		}
	};
}
