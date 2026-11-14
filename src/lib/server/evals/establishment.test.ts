import { describe, expect, it } from 'vitest';
import cases from '../../../../evals/establishment/cases.json';
import { ALL_KITCHENS } from '$lib/kitchen/catalog';
import { matchEstablishment } from '$lib/server/establishment';

/** Describe your kitchen (D15), fixture path: each description lands on its seeded kitchen with an honest why. */
describe('establishment match (rules)', () => {
	for (const c of cases.cases)
		it(c.id, async () => {
			const m = await matchEstablishment(c.text, ALL_KITCHENS, null);
			expect(m.kitchenId).toBe(c.kitchenId);
			expect(m.close).toBe(c.close);
			expect(m.source).toBe('rules');
			expect(m.notes).toBe(c.text);
			for (const w of c.whyIncludes ?? []) expect(m.why).toContain(w);
			expect(m.why.length).toBeLessThan(240);
		});

	it('falls back to the rules when the model names no seeded kitchen', async () => {
		const llm = {
			generate: async () => ({
				text: '{"kitchenId":"k-invented","why":"made up","close":true}',
				model: 'gemini-test',
				tokens: { in: 1, out: 1 },
				latencyMs: 1
			})
		};
		const m = await matchEstablishment('A school kitchen for 3 schools', ALL_KITCHENS, llm);
		expect(m).toMatchObject({ kitchenId: 'k-central', source: 'rules' });
		expect(m.rejected).toBeTruthy();
	});

	it("takes the model's answer when it names a seeded kitchen", async () => {
		const llm = {
			generate: async () => ({
				text: '{"kitchenId":"k-alacarte","why":"An evening tasting menu is closest to the à la carte bistro.","close":true}',
				model: 'gemini-test',
				tokens: { in: 1, out: 1 },
				latencyMs: 1
			})
		};
		const m = await matchEstablishment('Evening tasting menu, 40 seats', ALL_KITCHENS, llm);
		expect(m).toMatchObject({ kitchenId: 'k-alacarte', source: 'gemini', close: true });
	});
});
