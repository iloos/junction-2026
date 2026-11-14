/** Review round 3, finding 6: recipe fit from Decide feeds the substitute ranking, with its provenance. */
import { describe, expect, it } from 'vitest';
import { SCOPES_BY_ACTOR } from '$lib/core/contracts';
import type { CallContext, Decide } from '$lib/core/ports';
import { createHandlers } from '$lib/core/services/handlers';
import { createDbPorts } from './db-ports';

const chef: CallContext = {
	workspaceId: 'ws-demo',
	runId: 'run-1',
	actor: { kind: 'chef', id: 'chef-1' },
	scopes: SCOPES_BY_ACTOR.chef,
	via: 'test'
};
const must = <T>(
	r: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }
): T => {
	if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
	return r.value;
};

/** Juhlakinkku is the planned dish (4); smoked palvikinkku is a different ham (1). */
const stubDecide = (asked: string[]): Decide => ({
	yesNo: async () => {
		throw new Error('unused');
	},
	choice: async () => {
		throw new Error('unused');
	},
	score: async (q) => {
		asked.push(q.question);
		const candidate = q.context.match(/Candidate: (.*)\.$/)?.[1] ?? '';
		const value = /Juhlakinkku/i.test(candidate) ? 4 : /Palvikinkku/i.test(candidate) ? 1 : 2;
		return { value, confidence: 0.9, source: 'gemini', model: 'gemini-decision-1', latencyMs: 210 };
	}
});

async function rescueHam(decide?: Decide) {
	const env = await createDbPorts();
	env.overlay.clear();
	if (decide) env.ports.decide = decide;
	const h = createHandlers(env.ports);
	const { plan } = must(
		await h.plan_event(chef, { kitchenId: 'k-hotel', eventId: 'event-xmas-140' })
	);
	const ham = plan.lines.find((l) => l.productId === '462490')!;
	return must(
		await h.find_substitutes(chef, { planId: plan.id, version: plan.version, lineId: ham.id })
	);
}

describe('recipe fit in the substitute ranking', () => {
	it('asks Decide about the top survivors and lets dish fit change the recommendation', async () => {
		const asked: string[] = [];
		const r = await rescueHam(stubDecide(asked));
		expect(asked.length).toBeGreaterThan(0);
		expect(asked.length).toBeLessThanOrEqual(3);
		const top = r.candidates.find((c) => c.rank === 1)!;
		expect(top.productId).toBe('462919'); // the real juhlakinkku wins on fit over cheaper smoked ham
		expect(top.score?.fit).toMatchObject({
			score: 4,
			provenance: {
				source: 'llm',
				ref: 'gemini-decision-1',
				note: expect.stringContaining('210 ms')
			}
		});
		expect(r.chosen.map((l) => l.productId)).toEqual(['462919']);
	});

	it('falls back to the deterministic ranking when Decide fails', async () => {
		const failing: Decide = {
			yesNo: async () => {
				throw new Error('down');
			},
			choice: async () => {
				throw new Error('down');
			},
			score: async () => {
				throw new Error('provider down');
			}
		};
		const r = await rescueHam(failing);
		const top = r.candidates.find((c) => c.rank === 1)!;
		expect(top.productId).toBe('476768');
		expect(top.score?.fit).toBeUndefined();
	});
});
