/**
 * Round-4 triage #2 and the prod incident (996 ops in ~100 s with `/` open): reading the kitchen snapshot must never
 * write. Planning and rescue proposals happen once, through the explicit `start` command.
 */
import { describe, expect, it } from 'vitest';
import { createServerPorts } from '$lib/server/store/server-ports';
import { currentRun } from '$lib/server/demo/run';
import { callTool, scenario, snapshot } from './live';

async function seq(workspaceId: string): Promise<number> {
	const b = await createServerPorts();
	return (await b.ports.store.load(workspaceId, currentRun(workspaceId))).seq;
}

describe('kitchen snapshot is a read', () => {
	it('appends zero ops over 20 snapshots, before and after start, under every preset', async () => {
		const sid = `test-${Date.now()}`;
		const W = 'ws-demo';
		const first = await snapshot(sid, W);
		expect('started' in first && first.started === false).toBe(true);

		const started = await scenario(sid, W, 'start', undefined);
		expect('plan' in started).toBe(true);
		const ws = 'plan' in started ? started.plan.workspaceId : W;
		const before = await seq(ws);

		for (let i = 0; i < 20; i++) await snapshot(sid, W);
		expect(await seq(ws)).toBe(before);

		// Previewing other rules ranks without persisting.
		for (const p of ['price', 'finnish', 'kitchen'] as const) {
			await scenario(sid, W, 'preset', p);
			await snapshot(sid, W);
		}
		expect(await seq(ws)).toBe(before);

		// Starting again is idempotent: the plan exists and every outage already has a proposal.
		await scenario(sid, W, 'start', undefined);
		expect(await seq(ws)).toBe(before);
	}, 60_000);
});

describe('per-line decisions', () => {
	it('approve with one lineId leaves that line granted in `approvals` while `approval` moves to the remainder', async () => {
		const sid = `test-lines-${Date.now()}`;
		const W = `ws-lines-${Date.now()}`;
		const started = await scenario(sid, W, 'start', undefined);
		if (!('plan' in started)) throw new Error('not started');
		const a = started.approval!;
		expect(a.state).toBe('pending');
		const one = a.lineIds.find((id) => {
			const l = started.plan.lines.find((x) => x.id === id);
			return l && l.tier !== 'sign_off';
		})!;
		const r = await callTool(
			sid,
			W,
			'approve',
			{
				approvalId: a.id,
				planVersion: a.planVersion,
				termsHash: a.termsHash,
				decision: 'grant',
				lineIds: [one]
			},
			// What the page was rendered from: the route refuses a decision on an unnamed view.
			{ runId: started.clock!.runId, planId: started.plan.id, version: started.plan.version }
		);
		expect(r.ok).toBe(true);

		const after = await snapshot(sid, W);
		if (!('plan' in after)) throw new Error('not started');
		const granted = after.approvals?.find((x) => x.lineIds.includes(one));
		expect(granted?.state).toBe('granted');
		expect(after.approval?.lineIds).not.toContain(one);
		expect(after.approval?.state).toBe('pending');
	}, 60_000);
});
