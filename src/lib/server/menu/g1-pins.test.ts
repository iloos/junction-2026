/**
 * G1 (review 15 Nov): an unreviewed model pick became the kitchen's memory and skipped the resolver, so a chicken pick
 * reappeared in a vegan menu. A model pick now counts only from a reviewed menu, and every pin (model, chef or a
 * caller's hint) is checked against the new menu's plant diet before use.
 */
import { describe, expect, it } from 'vitest';
import type { EventBrief } from '$lib/core/contracts';
import type { Llm } from '$lib/core/ports';
import { createDbPorts } from '../store/db-ports';
import { editMenu } from './flow';
import { proposeMenu } from './proposal';
import { memoryMenuStore } from './store';

function scripted(...replies: ((prompt: string) => string)[]): Llm & { calls: string[] } {
	const calls: string[] = [];
	return {
		calls,
		async generate(req) {
			calls.push(req.prompt);
			const next = replies[calls.length - 1] ?? (() => '{}');
			return { text: next(req.prompt), model: 'stub', tokens: { in: 1, out: 1 }, latencyMs: 1 };
		}
	};
}

const at = new Date('2026-12-07T10:00:00Z');
const brief = (title: string, dietary: string[]): EventBrief =>
	({
		title,
		date: '2026-12-10',
		guests: 10,
		serviceStyle: 'plated',
		courses: 1,
		dietary,
		provenance: { source: 'user' }
	}) as EventBrief;
const bowl = (claims: string[]) => () =>
	JSON.stringify({
		dishes: [
			{
				name: 'Bowl',
				course: 'main',
				claimedCompatible: claims,
				ingredients: [
					{ label: 'chicken', query: 'broilerin rintafilee', amountPerCover: 120, unit: 'g' }
				]
			}
		],
		open: []
	});
/** The chooser takes the first candidate it is shown. */
const takeFirst = (prompt: string) => {
	const sent = JSON.parse(prompt).items as { key: string; candidates: { id: string }[] }[];
	return JSON.stringify({
		choices: sent.map((s) => ({
			key: s.key,
			productId: s.candidates[0]?.id ?? null,
			reason: 'first',
			concern: null
		}))
	});
};

describe('G1: remembered picks are hints, checked against the new menu', () => {
	it('a model chicken pick from an unreviewed menu never reaches a vegan menu', async () => {
		const env = await createDbPorts();
		const store = memoryMenuStore();
		const deps = {
			kitchenId: 'k-hotel',
			workspaceId: env.workspaceId,
			store,
			catalog: env.ports.catalog,
			now: at
		};
		const r1 = await proposeMenu({
			...deps,
			brief: brief('Chicken', []),
			llm: scripted(bowl([]), takeFirst)
		});
		const chicken = r1.proposal.dishes[0].ingredients[0];
		expect(chicken.productId).toBeTruthy();
		expect(chicken.pinnedBy).toBe('model');
		const r2 = await proposeMenu({
			...deps,
			brief: brief('Vegan', ['vegan']),
			llm: scripted(bowl(['vegan']), takeFirst)
		});
		const i = r2.proposal.dishes[0].ingredients[0];
		expect(i.productId).not.toBe(chicken.productId);
		expect(i.provenance.note ?? '').not.toContain('chosen before');
	});

	it('even a chef’s chicken pin is not reused for a vegan dish', async () => {
		const env = await createDbPorts();
		const store = memoryMenuStore();
		const deps = {
			kitchenId: 'k-hotel',
			workspaceId: env.workspaceId,
			store,
			catalog: env.ports.catalog,
			now: at
		};
		const r1 = await proposeMenu({
			...deps,
			brief: brief('Chicken', []),
			llm: scripted(bowl([]), takeFirst)
		});
		const ing = r1.proposal.dishes[0].ingredients[0];
		const pinned = await editMenu(
			{ workspaceId: env.workspaceId, store, catalog: env.ports.catalog, now: () => at },
			{
				id: r1.proposal.id,
				revision: 0,
				changes: [{ kind: 'pin', ingredientId: ing.id, productId: ing.productId! }]
			}
		);
		expect(pinned.ok).toBe(true);
		const r2 = await proposeMenu({
			...deps,
			brief: brief('Vegan', ['vegan']),
			llm: scripted(bowl(['vegan']), takeFirst)
		});
		const i = r2.proposal.dishes[0].ingredients[0];
		expect(i.productId).not.toBe(ing.productId);
		expect(i.pinnedBy).not.toBe('chef');
		// The same pin still answers a menu without the diet.
		const r3 = await proposeMenu({
			...deps,
			brief: brief('Chicken again', []),
			llm: scripted(bowl([]))
		});
		expect(r3.proposal.dishes[0].ingredients[0].productId).toBe(ing.productId);
	});
});
