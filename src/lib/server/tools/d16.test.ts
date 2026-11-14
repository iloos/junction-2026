import { describe, expect, it } from 'vitest';
import { toolSchemas } from '$lib/core/contracts';
import { createGetContext } from '../agent/get-context';
import { mandateSentence } from '../agent/intents/questions';
import { trialWorkspace } from '../agent/trial-harness';
import { errorNext } from './mcp';

describe('D16 on the agent door', () => {
	it(
		'get_context states each kitchen’s hard constraints in the requirement vocabulary, allergens named',
		{ timeout: 60_000 },
		async () => {
			const w = await trialWorkspace();
			const r = await createGetContext(w.env.ports)(w.ctx('external_agent'), {});
			expect(r.ok).toBe(true);
			if (!r.ok) return;
			expect(toolSchemas.get_context.output.safeParse(r.value).success).toBe(true);
			for (const k of r.value.kitchens) {
				const c = k.constraints!;
				expect(c).toBeDefined();
				expect(['hold', 'reject']).toContain(c.unknownAllergenRecord);
				for (const f of c.freeFrom) expect(f.name).not.toBe('');
				for (const o of c.origin) expect(o.country).toBe(o.country.toLowerCase());
			}
			// Our own words never call anything "safe" (the chef's quoted words are theirs, kept as said).
			for (const k of r.value.kitchens)
				expect(mandateSentence(k).replace(/“[^”]*”/g, '')).not.toMatch(/\bsafe\b/);
		}
	);

	it('the mandate in words names allergens, required origin and the unknown-record rule', () => {
		const text = mandateSentence({
			id: 'k',
			name: 'Lounas',
			mandate: {
				words: 'Order alone up to €800 a line.',
				lineCapCents: 80000,
				orderCapCents: 100000,
				weeklyCapCents: 400000,
				hardLimitCents: 800000,
				neverDelegate: [],
				allergenFreeFrom: ['AN'],
				tenderListOnly: false
			},
			constraints: {
				freeFrom: [{ code: 'AN', name: 'nuts' }],
				origin: [{ categoryGroup: '10', rule: 'require', country: 'fi' }],
				notes: [],
				unknownAllergenRecord: 'hold',
				traces: 'hold'
			}
		});
		expect(text).toContain('free from nuts');
		expect(text).toContain('Origin required: Finland for category group 10');
		expect(text).toContain('no allergen record is held for a chef');
	});

	it('a requirement refusal points at find_substitutes for that line, naming the requirement and the fact', () => {
		const next = errorNext(
			{
				code: 'FORBIDDEN',
				sub: 'requirement_unmet',
				detail: {
					lines: [
						{
							lineId: 'l-1',
							productId: '462201',
							unmet: [
								{
									requirement: 'diet:vegetarian',
									from: 'dish',
									verdict: 'no',
									fact: 'a meat product (category or name)'
								}
							]
						},
						{ lineId: 'l-2', productId: '460000', unmet: [] }
					]
				}
			},
			{ planId: 'pl-1', version: 3 }
		);
		expect(next).toMatchObject({
			tool: 'find_substitutes',
			args: { planId: 'pl-1', version: 3, lineId: 'l-1' }
		});
		expect(next!.why).toContain('diet:vegetarian (a meat product (category or name))');
		expect(next!.why).toContain('never relaxed');
		expect(next!.why).toContain('the other 1 line(s)');
		expect(next!.why.length).toBeLessThanOrEqual(200);
	});
});
