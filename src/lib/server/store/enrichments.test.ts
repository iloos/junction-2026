/** Web lane Need 2: enrichments are durable workspace knowledge, latest op wins, and they outlive a demo run. */
import { describe, expect, it } from 'vitest';
import type { PendingOp } from '$lib/core/contracts';
import { createDrizzleStore } from './drizzle-store';
import { createDbPorts } from './db-ports';

const enrich = (runId: string, value: unknown, note: string): PendingOp => ({
	workspaceId: 'ws-demo',
	runId,
	actor: { kind: 'job', id: 'enrich-job' },
	via: 'test:enrich',
	op: {
		type: 'RecordEnrichment',
		productId: '462150',
		field: 'categoryLabel',
		value,
		provenance: { source: 'llm', note }
	}
});

describe('enrichments', () => {
	it('keep the latest value per product and field and survive a new run', async () => {
		const env = await createDbPorts();
		const { store } = env;
		for (const [v, n] of [
			['fish', 'first pass'],
			['fresh salmon fillet', 'second pass']
		] as const) {
			const r = await store.transact('ws-demo', async () => ({
				ops: [enrich('run-1', v, n)],
				value: null
			}));
			expect(r.ok).toBe(true);
		}
		const s1 = await store.load('ws-demo', 'run-1');
		expect(s1.enrichments['462150']?.categoryLabel).toMatchObject({
			value: 'fresh salmon fillet',
			provenance: { source: 'llm', note: 'second pass' }
		});

		// A demo reset starts a new run in the same workspace: the knowledge is still there.
		const run2 = createDrizzleStore(env.db, { runOf: () => 'run-2' });
		await run2.ensure({
			workspaceId: 'ws-demo',
			runId: 'run-2',
			kitchens: [],
			simStart: '2026-12-07T21:40:00+02:00'
		});
		const s2 = await run2.load('ws-demo', 'run-2');
		expect(s2.enrichments['462150']?.categoryLabel?.value).toBe('fresh salmon fillet');
		expect(Object.keys(s2.plans)).toHaveLength(0); // plans stay per run
	});
});
