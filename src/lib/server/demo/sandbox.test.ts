import { describe, expect, it } from 'vitest';
import { currentRun } from './run';
import { resetSandbox, SANDBOX_COOLDOWN_MS, SANDBOX_WORKSPACE } from './sandbox';
import { newVisitorWorkspace } from './visitor-id';

describe('sandbox reset', () => {
	it('starts ws-judges over, never ws-demo, and holds a cooldown', async () => {
		const demoBefore = currentRun('ws-demo');
		const t = Date.now();
		const first = await resetSandbox(SANDBOX_WORKSPACE, t);
		expect(first.ok).toBe(true);
		if (first.ok) expect(currentRun(SANDBOX_WORKSPACE)).toBe(first.runId);
		expect(currentRun('ws-demo')).toBe(demoBefore);
		const again = await resetSandbox(SANDBOX_WORKSPACE, t + 1000);
		expect(again).toEqual({ ok: false, retryInMs: SANDBOX_COOLDOWN_MS - 1000 });
		expect((await resetSandbox(SANDBOX_WORKSPACE, t + SANDBOX_COOLDOWN_MS + 1)).ok).toBe(true);
	}, 30_000);

	it('keeps a cooldown per sandbox, and refuses the stage', async () => {
		const a = newVisitorWorkspace();
		const b = newVisitorWorkspace();
		const t = Date.now();
		const ra = await resetSandbox(a, t);
		expect(ra.ok).toBe(true);
		// Another visitor's reset is not held up by a's cooldown, and never moves a's run.
		const runA = currentRun(a);
		expect((await resetSandbox(b, t + 1)).ok).toBe(true);
		expect(currentRun(a)).toBe(runA);
		expect(currentRun(b)).not.toBe(runA);
		expect((await resetSandbox(a, t + 2)).ok).toBe(false);
		expect(await resetSandbox('ws-demo', t)).toEqual({ ok: false, forbidden: true });
	}, 30_000);
});
