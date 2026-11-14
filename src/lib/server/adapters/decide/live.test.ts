import { describe, expect, it } from 'vitest';
import { createDecide } from './index';

/**
 * One real Gemini Decisions call, opt-in only (costs a fraction of a cent):
 *   DECIDE_LIVE=1 node --env-file=.env node_modules/vitest/vitest.mjs run --project server src/lib/server/adapters/decide/live.test.ts
 */
describe.skipIf(process.env.DECIDE_LIVE !== '1')('Gemini Decisions, live', () => {
	it('scores a recipe fit and reports source, model and latency', async () => {
		const traces: unknown[] = [];
		const decide = createDecide({
			env: { ...process.env, LLM_PROVIDER: 'gemini' } as never,
			trace: (t) => void traces.push(t)
		});
		const d = await decide.score({
			question:
				'How well does this product replace a whole oven-baked Christmas ham on a Finnish hotel Christmas buffet?',
			rubric:
				'0 = unusable, 1 = poor, 2 = acceptable with changes, 3 = good, 4 = equivalent for the dish',
			context:
				'Candidate: HK Palvikinkku viipaloitu 1,5 kg (smoked, cooked, sliced pork ham, Finnish). Dish: Joulukinkku, served sliced cold or warm with mustard.',
			max: 4
		});
		console.log('decision', JSON.stringify(d), 'traces', traces.length);
		expect(d.source).toBe('gemini');
		expect(d.value).toBeGreaterThanOrEqual(0);
		expect(d.value).toBeLessThanOrEqual(4);
	}, 30_000);

	it('answers a rescue batch (fit, violates, origin per candidate) in one call', async () => {
		const traces: Record<string, unknown>[] = [];
		const decide = createDecide({
			env: { ...process.env, LLM_PROVIDER: 'gemini' } as never,
			trace: (_s, d) => void traces.push(d)
		});
		const context = JSON.stringify({
			dish: 'Graavilohi (cured salmon) on a Finnish hotel Christmas buffet',
			hard_constraints: ['no shellfish'],
			candidates: [
				{ id: 'trout', name: 'Kirjolohifilee, suomalainen kasvatettu' },
				{ id: 'shrimp', name: 'Katkarapu kypsä kuorittu, Thaimaa' }
			]
		});
		const r = await decide.batch!(
			['trout', 'shrimp'].flatMap((id) => [
				{
					id: `${id}_fit`,
					kind: 'score' as const,
					question: `How well does candidate "${id}" replace the salmon in this dish?`,
					rubric: 'unusable;poor;acceptable with changes;good;equivalent',
					max: 4,
					context
				},
				{
					id: `${id}_violates`,
					kind: 'yes_no' as const,
					question: `Does candidate "${id}" break any hard constraint?`,
					context
				}
			])
		);
		console.log(JSON.stringify(r), JSON.stringify(traces[0]));
		expect(r.trout_fit.source).toBe('gemini');
		expect(r.shrimp_violates.p).toBeGreaterThan(0.5);
		expect(r.trout_fit.value).toBeGreaterThan(r.shrimp_fit.value as number);
		expect(traces.filter((t) => t.cache === 'live')).toHaveLength(1);
	}, 30_000);

	it('gets JSON from Flash-Lite for a request parse prompt', async () => {
		const { geminiLlm, geminiKey } = await import('../llm');
		const llm = geminiLlm(geminiKey(process.env as never)!);
		const r = await llm.generate({
			system:
				'Extract purchase items as JSON: {"items":[{"query":string,"qty":number,"unit":string}],"deliverBy":string}',
			prompt: '1,000 L lactose-free milk by Monday',
			maxTokens: 300,
			json: true
		});
		const parsed = JSON.parse(r.text) as { items: { qty: number; unit: string }[] };
		expect(parsed.items[0].qty).toBe(1000);
		expect(r.model).toContain('flash-lite');
	}, 30_000);
});
