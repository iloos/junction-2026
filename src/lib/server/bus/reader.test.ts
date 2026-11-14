import { describe, expect, it } from 'vitest';
import { createDbPorts } from '$lib/server/store/db-ports';
import { drizzleOpsReader } from './index';

describe('drizzleOpsReader', () => {
	it('reads committed ops from the PGlite store in seq order', async () => {
		const published: number[] = [];
		const { store, db, workspaceId } = await createDbPorts({
			publish: (_ws, events) => events.forEach((e) => 'seq' in e && published.push(e.seq))
		});
		const r = await store.transact(workspaceId, async () => ({
			value: null,
			ops: [
				{
					workspaceId,
					runId: 'run-1',
					actor: { kind: 'system', id: 'test' },
					via: 'test',
					op: {
						type: 'RecordAnomaly',
						anomaly: {
							workspaceId,
							runId: 'run-1',
							id: 'an-1',
							kind: 'cutoff',
							message: 'test',
							detectedAt: '2026-11-14T12:00:00+02:00',
							provenance: { source: 'simulator' }
						}
					}
				}
			]
		}));
		expect(r.ok).toBe(true);
		const ops = await drizzleOpsReader(db)(workspaceId, 0, 10);
		expect(ops.map((o) => o.op.type)).toEqual(['RecordAnomaly']);
		expect(published).toEqual([ops[0].seq]);
	}, 30_000);
});
