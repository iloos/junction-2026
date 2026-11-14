/** Recipe fit from Decide feeds the substitute ranking, with its provenance. */
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
	it('asks Decide about the top survivors; fit reorders within a supply tier, never above it (D8)', async () => {
		const asked: string[] = [];
		const r = await rescueHam(stubDecide(asked));
		expect(asked.length).toBeGreaterThan(0);
		expect(asked.length).toBeLessThanOrEqual(3);
		// Palvikinkku 476768 is in Stock; the juhlakinkku 462919 that fits the dish better is Terminal, unknown supply.
		const top = r.candidates.find((c) => c.rank === 1)!;
		expect(top.productId).toBe('476768');
		expect(top.score?.fit).toMatchObject({
			score: 1,
			provenance: {
				source: 'llm',
				ref: 'gemini-decision-1',
				note: expect.stringContaining('210 ms')
			}
		});
		const juhla = r.candidates.find((c) => c.productId === '462919')!;
		expect(juhla.score?.fit?.score).toBe(4);
		expect(juhla.rank).toBeGreaterThan(1);
		expect(r.chosen.map((l) => l.productId)).toEqual(['476768']);
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

describe('rescue batch (Decide.batch): fit, constraint check and origin in one call per line', () => {
	const batchDecide = (calls: number[], violatesP: number | undefined): Decide => ({
		yesNo: async () => {
			throw new Error('unused');
		},
		choice: async () => {
			throw new Error('unused');
		},
		score: async () => {
			throw new Error('unused');
		},
		batch: async (qs) => {
			calls.push(qs.length);
			return Object.fromEntries(
				qs.map((q) => {
					const palvi = /Palvikinkku/i.test(q.question);
					const base = { confidence: 0.9, source: 'gemini' as const, latencyMs: 300 };
					if (q.id.endsWith('_fit')) return [q.id, { ...base, value: palvi ? 1 : 3 }];
					if (q.id.endsWith('_violates'))
						return [
							q.id,
							palvi && violatesP !== undefined
								? { ...base, value: violatesP > 0.5, p: violatesP }
								: { ...base, value: false, p: 0.02 }
						];
					return [q.id, { ...base, value: true, p: 0.93 }];
				})
			);
		}
	});

	it('asks once, shows confidence and origin, and a calibrated violation rejects the candidate', async () => {
		const calls: number[] = [];
		const r = await rescueHam(batchDecide(calls, 0.97));
		expect(calls).toHaveLength(1);
		expect(calls[0] % 3).toBe(0);
		const palvi = r.candidates.find((c) => c.productId === '476768')!;
		expect(palvi.rank).toBeNull();
		expect(palvi.rejectedReasons).toEqual(['FORBIDDEN.gemini_constraint_p0.97']);
		const top = r.candidates.find((c) => c.rank === 1)!;
		expect(top.score?.fit?.provenance.note).toMatch(/conf 0\.90.*Finnish origin p 0\.93/);
	});

	it('an answer without p (rules) never rejects', async () => {
		const r = await rescueHam(batchDecide([], undefined));
		expect(r.candidates.find((c) => c.productId === '476768')!.rank).not.toBeNull();
	});
});
