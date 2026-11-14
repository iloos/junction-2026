/**
 * Round-4 triage #2 and the prod incident (996 ops in ~100 s with `/` open): reading the kitchen snapshot must never
 * write. Planning and rescue proposals happen once, through the explicit `start` command.
 */
import { describe, expect, it } from 'vitest';
import { createServerPorts } from '$lib/server/store/server-ports';
import { currentRun } from '$lib/server/demo/run';
import { scenario, snapshot } from './live';

async function seq(workspaceId: string): Promise<number> {
	const b = await createServerPorts();
	return (await b.ports.store.load(workspaceId, currentRun(workspaceId))).seq;
}

describe('kitchen snapshot is a read', () => {
	it('appends zero ops over 20 snapshots, before and after start, under every preset', async () => {
		const sid = `test-${Date.now()}`;
		const first = await snapshot(sid);
		expect('started' in first && first.started === false).toBe(true);

		const started = await scenario(sid, 'start', undefined);
		expect('plan' in started).toBe(true);
		const ws = 'plan' in started ? started.plan.workspaceId : 'ws-demo';
		const before = await seq(ws);

		for (let i = 0; i < 20; i++) await snapshot(sid);
		expect(await seq(ws)).toBe(before);

		// Previewing other rules ranks without persisting.
		for (const p of ['price', 'finnish', 'kitchen'] as const) {
			await scenario(sid, 'preset', p);
			await snapshot(sid);
		}
		expect(await seq(ws)).toBe(before);

		// Starting again is idempotent: the plan exists and every outage already has a proposal.
		await scenario(sid, 'start', undefined);
		expect(await seq(ws)).toBe(before);
	}, 60_000);
});
