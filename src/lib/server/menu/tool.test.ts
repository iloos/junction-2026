import { describe, expect, it } from 'vitest';
import { SCOPES_BY_ACTOR } from '$lib/core/contracts';
import type { CallContext } from '$lib/core/ports';
import { createDbPorts } from '../store/db-ports';
import { goldenBrief } from './golden';
import { memoryMenuStore } from './store';
import { proposeMenuHandler } from './tool';

const ctx = (kind: 'external_agent' | 'approver', kitchenIds?: string[]): CallContext => ({
	workspaceId: 'ws-t',
	runId: 'r',
	actor: { kind, id: 'k' },
	scopes: SCOPES_BY_ACTOR[kind],
	via: 'test',
	...(kitchenIds ? { kitchenIds } : {})
});

describe('propose_menu handler', () => {
	it('stores revision 0 and returns it with the rubric issues and a next action to the chef', async () => {
		const env = await createDbPorts();
		const menus = memoryMenuStore();
		const h = proposeMenuHandler({ ports: { ...env.ports, menus } });
		const r = await h(ctx('external_agent'), {
			kitchenId: 'k-hotel',
			brief: goldenBrief('christmas')
		});
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.value.proposal.revision).toBe(0);
		expect(r.value.proposal.status).toBe('proposed');
		expect(await menus.get('ws-t', r.value.proposal.id, 0)).toBeTruthy();
		expect(r.value.meta?.summary).toMatch(/nothing was planned or ordered/);
	});

	it('refuses without the plan scope, for another kitchen, or a malformed brief', async () => {
		const env = await createDbPorts();
		const h = proposeMenuHandler({ ports: { ...env.ports, menus: memoryMenuStore() } });
		const brief = goldenBrief('christmas');
		const a = await h(ctx('approver'), { kitchenId: 'k-hotel', brief });
		expect(!a.ok && a.error.code).toBe('FORBIDDEN');
		const b = await h(ctx('external_agent', ['k-lounas']), { kitchenId: 'k-hotel', brief });
		expect(!b.ok && b.error.code).toBe('FORBIDDEN');
		const c = await h(ctx('external_agent'), {
			kitchenId: 'k-hotel',
			brief: { ...brief, guests: 0 }
		});
		expect(!c.ok && c.error.code).toBe('INVALID_INPUT');
	});
});
