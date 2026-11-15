/**
 * Menu stability: "Lunch for 80" gave €127–€268 across three runs, since each submission (a new nonce) asked the model
 * again and Gemini 3.x takes no temperature. The model's menu is kept per kitchen and normalised brief.
 */
import { describe, expect, it } from 'vitest';
import type { EventBrief } from '$lib/core/contracts';
import type { Llm } from '$lib/core/ports';
import { createDbPorts } from '../store/db-ports';
import { proposeMenu, type ModelMenus } from './proposal';
import { memoryMenuStore } from './store';

/** A model that writes a different soup every time it is asked. */
function drifting(): Llm & { menus: number } {
	const m = {
		menus: 0,
		async generate(req: { prompt: string }) {
			const isMenu = req.prompt.startsWith('Brief:');
			if (isMenu) m.menus++;
			const text = isMenu
				? JSON.stringify({
						dishes: [
							{
								name: `Soup ${m.menus}`,
								course: 'soup',
								ingredients: [
									{
										label: 'salmon',
										query: 'lohifilee',
										amountPerCover: 60 + m.menus * 10,
										unit: 'g'
									}
								]
							}
						],
						open: []
					})
				: JSON.stringify({ choices: [] });
			return { text, model: 'stub', tokens: { in: 1, out: 1 }, latencyMs: 1 };
		}
	};
	return m as Llm & { menus: number };
}

const lunch = (title: string, guests = 80): EventBrief =>
	({
		title,
		date: '2026-12-11',
		guests,
		serviceStyle: 'plated',
		courses: 1,
		dietary: [],
		provenance: { source: 'user' }
	}) as EventBrief;

describe('the same brief gets the same menu', () => {
	it('a resubmission (new nonce, other casing and punctuation) reuses the model’s menu', async () => {
		const env = await createDbPorts();
		const llm = drifting();
		const modelMenus: ModelMenus = new Map();
		const base = {
			kitchenId: 'k-lounas',
			workspaceId: env.workspaceId,
			store: memoryMenuStore(),
			catalog: env.ports.catalog,
			now: new Date('2026-12-07T10:00:00Z'),
			llm,
			modelMenus
		};
		const a = await proposeMenu({ ...base, brief: lunch('Lunch for 80'), nonce: 'one' });
		const b = await proposeMenu({ ...base, brief: lunch('lunch for 80!'), nonce: 'two' });
		expect(llm.menus).toBe(1);
		expect(b.proposal.dishes.map((d) => d.name)).toEqual(a.proposal.dishes.map((d) => d.name));
		expect(b.proposal.dishes[0].ingredients[0].amountPerCover).toBe(
			a.proposal.dishes[0].ingredients[0].amountPerCover
		);
		// Another kitchen, or another guest count, is another brief.
		await proposeMenu({
			...base,
			kitchenId: 'k-hotel',
			brief: lunch('Lunch for 80'),
			nonce: 'three'
		});
		await proposeMenu({ ...base, brief: lunch('Lunch for 80', 120), nonce: 'four' });
		expect(llm.menus).toBe(3);
	});

	it('without the shared map (tests, scripts) every call asks the model', async () => {
		const env = await createDbPorts();
		const llm = drifting();
		const base = {
			kitchenId: 'k-lounas',
			workspaceId: env.workspaceId,
			store: memoryMenuStore(),
			catalog: env.ports.catalog,
			now: new Date('2026-12-07T10:00:00Z'),
			llm
		};
		await proposeMenu({ ...base, brief: lunch('Lunch for 80'), nonce: 'one' });
		await proposeMenu({ ...base, brief: lunch('Lunch for 80'), nonce: 'two' });
		expect(llm.menus).toBe(2);
	});
});
