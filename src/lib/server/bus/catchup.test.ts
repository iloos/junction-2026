import { afterEach, describe, expect, it } from 'vitest';
import type { PendingOp } from '$lib/core/contracts';
import { createDbPorts, loadSeedKitchens } from '$lib/server/store/db-ports';
import { createDrizzleStore } from '$lib/server/store/drizzle-store';
import { catchUp, drizzleOpsReader, setFixtureOpsReader } from './index';

const anomaly = (workspaceId: string, runId: string, id: string): PendingOp => ({
	workspaceId,
	runId,
	actor: { kind: 'system', id: 'test' },
	via: 'test',
	op: {
		type: 'RecordAnomaly',
		anomaly: {
			workspaceId,
			runId,
			id,
			kind: 'cutoff',
			message: id,
			detectedAt: '2026-12-07T21:40:00+02:00',
			provenance: { source: 'simulator' }
		}
	}
});

afterEach(() => setFixtureOpsReader(null));

describe('catchUp after a reset', () => {
	it('returns the current run even behind more than 1000 ops of older runs', async () => {
		const { store, db, workspaceId } = await createDbPorts();
		const old = Array.from({ length: 1100 }, (_, i) => anomaly(workspaceId, 'run-1', `old-${i}`));
		expect((await store.transact(workspaceId, async () => ({ value: null, ops: old }))).ok).toBe(
			true
		);

		const fresh = createDrizzleStore(db, {
			runOf: () => 'run-2',
			now: () => new Date('2026-12-07T21:40:00+02:00'),
			publish: () => {}
		});
		await fresh.ensure({
			workspaceId,
			runId: 'run-2',
			kitchens: loadSeedKitchens(),
			simStart: '2026-12-07T21:40:00+02:00'
		});
		const r = await fresh.transact(workspaceId, async () => ({
			value: null,
			ops: [anomaly(workspaceId, 'run-2', 'new-1')]
		}));
		expect(r.ok).toBe(true);

		setFixtureOpsReader(drizzleOpsReader(db));
		const events = await catchUp(workspaceId, 0, 1000, 'run-2');
		expect(events.map((e) => (e.kind === 'op' ? e.envelope.runId : e.kind))).toEqual(['run-2']);
		expect((await catchUp(workspaceId, 0, 1000)).length).toBe(1000);
	}, 60_000);
});
