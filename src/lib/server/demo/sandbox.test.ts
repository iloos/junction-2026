import { describe, expect, it } from 'vitest';
import { currentRun } from './run';
import { resetSandbox, SANDBOX_COOLDOWN_MS, SANDBOX_WORKSPACE } from './sandbox';

describe('sandbox reset', () => {
	it('starts ws-judges over, never ws-demo, and holds a cooldown', async () => {
		const demoBefore = currentRun('ws-demo');
		const t = Date.now();
		const first = await resetSandbox(t);
		expect(first.ok).toBe(true);
		if (first.ok) expect(currentRun(SANDBOX_WORKSPACE)).toBe(first.runId);
		expect(currentRun('ws-demo')).toBe(demoBefore);
		const again = await resetSandbox(t + 1000);
		expect(again).toEqual({ ok: false, retryInMs: SANDBOX_COOLDOWN_MS - 1000 });
		expect((await resetSandbox(t + SANDBOX_COOLDOWN_MS + 1)).ok).toBe(true);
	}, 30_000);
});
