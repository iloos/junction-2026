import { describe, expect, it } from 'vitest';
import { SCOPES_BY_ACTOR } from '$lib/core/contracts';
import type { CallContext } from '$lib/core/ports';
import { createHandlers } from '$lib/core/services/handlers';
import { createDbPorts } from '$lib/server/store/db-ports';
import { createDecide, loadReplay } from './index';

/**
 * Records the Decide replay book from real Gemini calls over the demo rescue path (every line of the demo
 * events that find_substitutes can rescue). Opt-in only; costs a fraction of a cent:
 *   DECIDE_RECORD=1 node --env-file=.env node_modules/vitest/vitest.mjs run --project server src/lib/server/adapters/decide/record.test.ts
 * Replayed answers are always labelled `replay`, never `gemini`.
 */
const REPLAY = 'src/lib/server/adapters/decide/replay.json';
const EVENTS = [{ kitchenId: 'k-hotel', eventId: 'event-xmas-140' }];

const chef: CallContext = {
	workspaceId: 'ws-demo',
	runId: 'run-1',
	actor: { kind: 'chef', id: 'chef-1' },
	scopes: SCOPES_BY_ACTOR.chef,
	via: 'test'
};

describe.skipIf(process.env.DECIDE_RECORD !== '1')('record the Decide replay book', () => {
	it('asks the demo rescue batches live and writes them to replay.json', async () => {
		const before = Object.keys(loadReplay(REPLAY)).length;
		const env = await createDbPorts();
		env.overlay.clear();
		env.ports.decide = createDecide({
			env: { ...process.env, LLM_PROVIDER: 'gemini' } as never,
			replayPath: REPLAY,
			record: true
		});
		const h = createHandlers(env.ports);
		let rescued = 0;
		for (const e of EVENTS) {
			const r = await h.plan_event(chef, e);
			if (!r.ok) throw new Error(r.error.message);
			const plan = r.value.plan;
			for (const line of plan.lines.filter((l) => !l.substituteFor)) {
				const s = await h.find_substitutes(chef, {
					planId: plan.id,
					version: plan.version,
					lineId: line.id,
					apply: false
				});
				if (s.ok && s.value.candidates.some((c) => c.score?.fit)) rescued++;
			}
		}
		const after = Object.keys(loadReplay(REPLAY)).length;
		console.log(`rescued ${rescued} lines; replay book ${before} → ${after} answers`);
		expect(after).toBeGreaterThan(before);
	}, 600_000);
});
