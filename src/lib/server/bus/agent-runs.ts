import type { ServerEvent } from '$lib/core/contracts';
import { runRoutineAgent, type AgentRun } from '$lib/server/agent';
import type { Env } from '$lib/server/auth';
import { publish } from './index';

type Trace = Extract<ServerEvent, { kind: 'trace' }>;

export const DEFAULT_GOAL =
	'Plan the Christmas buffet for 140 at k-hotel and order what the mandate allows';
/** Goals are free text from a request; long ones are cut before they reach a model. */
const MAX_GOAL = 500;

const g = globalThis as typeof globalThis & {
	__mandateAgentRun?: { id: string; done: Promise<AgentRun> };
};

/**
 * Starts the routine agent unless one is already running in this process (spend cap: one loop at a time,
 * 8 steps each). Every trace event is tagged with `agentRun` and published to the bus, so /ops shows it live.
 */
export function startAgentRun(o: {
	goal?: string;
	env: Env;
	onEvent?: (e: Trace) => void;
}): { ok: true; id: string; done: Promise<AgentRun> } | { ok: false; busyWith: string } {
	if (g.__mandateAgentRun) return { ok: false, busyWith: g.__mandateAgentRun.id };
	const id = `agent-${Date.now().toString(36)}`;
	const goal = (o.goal?.trim() || DEFAULT_GOAL).slice(0, MAX_GOAL);
	const done = runRoutineAgent({
		goal,
		env: o.env,
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
	g.__mandateAgentRun = { id, done };
	return { ok: true, id, done };
}

export function agentRunning(): string | null {
	return g.__mandateAgentRun?.id ?? null;
}
