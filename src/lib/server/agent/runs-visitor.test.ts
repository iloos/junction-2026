/** OM-8: in a shared room, one visitor's agent run never makes another visitor's turn "busy". */
import { describe, expect, it } from 'vitest';
import type { AgentRun } from './index';
import { buildRunPrincipal } from './principal';
import { startAgentRun } from './runs';

const principal = (visitor: string | undefined, id: string) =>
	buildRunPrincipal({
		initiator: {
			actor: { kind: 'chef', id: 'chef' },
			workspaceId: 'ws-room',
			runId: 'run-1',
			scopes: ['read', 'plan', 'order', 'agent:run'],
			...(visitor ? { visitor } : {})
		},
		agentRunId: id
	})!;

describe('agent runs per visitor', () => {
	it('two visitors in one room run side by side; the same visitor waits', async () => {
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		const run = () => gate.then(() => ({}) as AgentRun);
		const a = startAgentRun({ env: {} as never, principal: principal('va', 'agent-a'), run });
		const b = startAgentRun({ env: {} as never, principal: principal('vb', 'agent-b'), run });
		const a2 = startAgentRun({ env: {} as never, principal: principal('va', 'agent-a2'), run });
		expect(a.ok).toBe(true);
		expect(b.ok).toBe(true);
		expect(a2).toMatchObject({ ok: false, busyWith: 'agent-a' });
		release();
		if (a.ok) await a.done.catch(() => {});
		if (b.ok) await b.done.catch(() => {});
	});
});
