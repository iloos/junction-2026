import type { Actor, ServerEvent } from '$lib/core/contracts';
import type { Env } from '$lib/server/auth';
import { publish } from '$lib/server/bus';
import { runRoutineAgent, type AgentRun } from './index';
import type { RunPrincipal } from './types';

type Trace = Extract<ServerEvent, { kind: 'trace' }>;

export const DEFAULT_GOAL =
	'Plan the Christmas buffet for 140 at k-hotel and order what the mandate allows';
/** Goals are free text from a request; long ones are cut before they reach a model. */
const MAX_GOAL = 500;

interface Running {
	id: string;
	done: Promise<AgentRun>;
	controller: AbortController;
	principal?: RunPrincipal;
	cancelledBy?: Actor;
}

const g = globalThis as typeof globalThis & { __mandateAgentRun?: Running };

export const newAgentRunId = () => `agent-${Date.now().toString(36)}`;

/**
 * Starts the routine agent unless one is already running in this process (spend cap: one loop at a time,
 * 8 steps each). Every trace event is tagged with `agentRun` and published to the bus, so /ops shows it live.
 * The run owns an AbortController: `cancelAgentRun` is the only way to stop it; a closed response is not.
 */
export function startAgentRun(o: {
	goal?: string;
	env: Env;
	onEvent?: (e: Trace) => void;
	/** Built by the caller from a server-derived context; absent = the /ops presenter button. */
	principal?: RunPrincipal;
	id?: string;
}): { ok: true; id: string; done: Promise<AgentRun> } | { ok: false; busyWith: string } {
	if (g.__mandateAgentRun) return { ok: false, busyWith: g.__mandateAgentRun.id };
	const id = o.principal?.agentRunId ?? o.id ?? newAgentRunId();
	const goal = (o.goal?.trim() || DEFAULT_GOAL).slice(0, MAX_GOAL);
	const controller = new AbortController();
	const done = runRoutineAgent({
		goal,
		env: o.env,
		principal: o.principal,
		signal: controller.signal,
		onEvent: (e) => {
			if (e.kind !== 'trace') return;
			const tagged: Trace = { ...e, data: { ...e.data, agentRun: id } };
			void publish(tagged.workspaceId, [tagged]).catch((err) =>
				console.error('[agent-run] publish failed', err)
			);
			o.onEvent?.(tagged);
		}
	}).finally(() => {
		if (g.__mandateAgentRun?.id === id) g.__mandateAgentRun = undefined;
	});
	g.__mandateAgentRun = { id, done, controller, principal: o.principal };
	return { ok: true, id, done };
}

/**
 * "Stop agent": aborts the named run. No tool starts after this returns; a tool already running finishes
 * and is recorded, and a model call in flight may still be billed by its provider.
 */
export function cancelAgentRun(
	id: string,
	by: Actor
): { ok: true; done: Promise<AgentRun> } | { ok: false; reason: 'not_running' } {
	const r = g.__mandateAgentRun;
	if (!r || r.id !== id) return { ok: false, reason: 'not_running' };
	r.cancelledBy ??= by;
	r.controller.abort();
	return { ok: true, done: r.done };
}

export function agentRunning(): string | null {
	return g.__mandateAgentRun?.id ?? null;
}
