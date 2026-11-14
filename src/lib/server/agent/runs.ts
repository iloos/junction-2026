import type { Actor, ServerEvent } from '$lib/core/contracts';
import { contextFor, type Env } from '$lib/server/auth';
import { publish } from '$lib/server/bus';
import { runRoutineAgent, type AgentRun } from './index';
import { buildRunPrincipal, PRESENTER } from './principal';
import type { RunPrincipal } from './types';

type Trace = Extract<ServerEvent, { kind: 'trace' }>;

export const DEFAULT_GOAL =
	'Plan the Christmas buffet for 140 at k-hotel and order what the mandate allows';
/** Goals are free text from a request; long ones are cut before they reach a model. */
const MAX_GOAL = 500;

interface Running {
	id: string;
	workspaceId: string;
	done: Promise<AgentRun>;
	controller: AbortController;
	principal?: RunPrincipal;
	cancelledBy?: Actor;
}

/** Runs in progress, one per workspace: a visitor's run never blocks another visitor's. */
const g = globalThis as typeof globalThis & { __mandateAgentRuns?: Map<string, Running> };
const runs = (g.__mandateAgentRuns ??= new Map<string, Running>());

/** Spend cap across the process: at most this many loops at once (8 steps each). */
export const MAX_CONCURRENT_RUNS = 8;

export const newAgentRunId = () =>
	`agent-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * Starts the routine agent unless one is already running in the same workspace (or the process is at its cap).
 * Every trace event is tagged with `agentRun` and published to the bus, so /ops shows it live. The run owns an
 * AbortController: `cancelAgentRun` is the only way to stop it; a closed response is not. Without a principal it
 * runs as the /ops presenter button in the stage workspace.
 */
export function startAgentRun(o: {
	goal?: string;
	env: Env;
	onEvent?: (e: Trace) => void;
	/** Built by the caller from a server-derived context; absent = the /ops presenter button. */
	principal?: RunPrincipal;
	id?: string;
	/** Runs `runGoal` with these instead of the server's defaults (chat turns, tests). */
	run?: (o: { signal: AbortSignal; onEvent: (e: ServerEvent) => void }) => Promise<AgentRun>;
}): { ok: true; id: string; done: Promise<AgentRun> } | { ok: false; busyWith: string } {
	const principal =
		o.principal ??
		buildRunPrincipal({
			initiator: contextFor(PRESENTER.kind, PRESENTER.id, 'ops', o.env),
			agentRunId: o.id ?? newAgentRunId(),
			presenter: true
		})!;
	const workspaceId = principal.workspaceId;
	const busy = runs.get(workspaceId);
	if (busy) return { ok: false, busyWith: busy.id };
	if (runs.size >= MAX_CONCURRENT_RUNS) return { ok: false, busyWith: 'capacity' };
	const id = principal.agentRunId;
	const goal = (o.goal?.trim() || DEFAULT_GOAL).slice(0, MAX_GOAL);
	const controller = new AbortController();
	const onEvent = (e: ServerEvent) => {
		if (e.kind !== 'trace') return;
		const tagged: Trace = { ...e, data: { ...e.data, agentRun: id } };
		void publish(tagged.workspaceId, [tagged]).catch((err) =>
			console.error('[agent-run] publish failed', err)
		);
		o.onEvent?.(tagged);
	};
	const done = (
		o.run
			? o.run({ signal: controller.signal, onEvent })
			: runRoutineAgent({ goal, env: o.env, principal, signal: controller.signal, onEvent })
	).finally(() => {
		if (runs.get(workspaceId)?.id === id) runs.delete(workspaceId);
	});
	runs.set(workspaceId, { id, workspaceId, done, controller, principal });
	return { ok: true, id, done };
}

/**
 * "Stop agent": aborts the named run, only from the workspace it runs in (a run in another workspace reads as not
 * running, so ids can't be probed across workspaces). `workspaceId` null is the /ops presenter button, which is
 * gated by its own sign-in. No tool starts after this returns; a tool already running finishes and is recorded,
 * and a model call in flight may still be billed by its provider.
 */
export function cancelAgentRun(
	id: string,
	by: Actor,
	workspaceId: string | null = null
): { ok: true; done: Promise<AgentRun> } | { ok: false; reason: 'not_running' } {
	const r = [...runs.values()].find((x) => x.id === id);
	if (!r || (workspaceId !== null && r.workspaceId !== workspaceId))
		return { ok: false, reason: 'not_running' };
	r.cancelledBy ??= by;
	r.controller.abort();
	return { ok: true, done: r.done };
}

/** The run in progress in a workspace, or (no workspace) any run in this process. */
export function agentRunning(workspaceId?: string): string | null {
	if (workspaceId) return runs.get(workspaceId)?.id ?? null;
	return runs.values().next().value?.id ?? null;
}
