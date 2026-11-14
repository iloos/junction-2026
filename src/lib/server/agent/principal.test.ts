import { describe, expect, it } from 'vitest';
import { SCOPES_BY_ACTOR, type ActorKind } from '$lib/core/contracts';
import { buildRunPrincipal, principalContext, PRESENTER } from './principal';

const initiator = (kind: ActorKind) => ({
	actor: { kind, id: `${kind}-key` },
	workspaceId: 'ws-demo',
	runId: 'run-1',
	scopes: SCOPES_BY_ACTOR[kind]
});

describe('RunPrincipal (finding A)', () => {
	it.each(['approver', 'external_agent', 'kitchen_agent', 'job'] as const)(
		'%s may not start the agent',
		(kind) => {
			expect(buildRunPrincipal({ initiator: initiator(kind), agentRunId: 'a' })).toBeNull();
		}
	);

	it('a chef starts it; rights are the intersection, never the union', () => {
		const p = buildRunPrincipal({ initiator: initiator('chef'), agentRunId: 'agent-1', now: 0 })!;
		expect(p.initiatedBy).toEqual({ kind: 'chef', id: 'chef-key' });
		expect(p.serviceActor.kind).toBe('kitchen_agent');
		expect(p.scopes).toEqual(['read', 'plan', 'order']);
		expect(p.scopes).not.toContain('approve');
		expect(p.scopes).not.toContain('mandate:write');
		expect(p.expiresAt).toBe(new Date(5 * 60_000).toISOString());
	});

	it('an initiator with fewer rights narrows the run', () => {
		const narrow = { ...initiator('chef'), scopes: ['read'] as const };
		const p = buildRunPrincipal({ initiator: narrow, agentRunId: 'a' })!;
		expect(p.scopes).toEqual(['read']);
	});

	it('the presenter button is a labelled system initiator', () => {
		const p = buildRunPrincipal({
			initiator: { ...initiator('system'), actor: PRESENTER },
			agentRunId: 'a',
			presenter: true
		})!;
		expect(p.initiatedBy).toEqual(PRESENTER);
		expect(p.scopes).toEqual(['read', 'plan', 'order']);
	});

	it('ops name both the agent and the initiator', () => {
		const p = buildRunPrincipal({ initiator: initiator('chef'), agentRunId: 'agent-9' })!;
		const ctx = principalContext(p);
		expect(ctx.actor).toEqual({ kind: 'kitchen_agent', id: 'routine-agent' });
		expect(ctx.via).toBe('agent:agent-9 by chef:chef-key');
	});
});
