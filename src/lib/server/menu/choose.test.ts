import { describe, expect, it } from 'vitest';
import type { Llm } from '$lib/core/ports';
import { createDbPorts } from '../store/db-ports';
import { chooseProducts, type ChoiceItem } from './choose';
import { proposeMenu } from './proposal';
import { editMenu } from './flow';
import { memoryMenuStore } from './store';

/** A model that answers each call with the next scripted reply (a function of the prompt, or text). */
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

const items: ChoiceItem[] = [
	{
		key: 'a',
		dish: 'Chicken tinga',
		label: 'Yellow onion',
		amount: '30 g per guest',
		candidates: [
			{ productId: 'p-powder', name: 'Sipuli jauhettu' },
			{ productId: 'p-sack', name: 'SIPULI 10KG SÄKKI SUOMI' }
		]
	},
	{
		key: 'b',
		dish: 'Chicken tinga',
		label: 'Chipotle in adobo',
		amount: '10 g per guest',
		candidates: [{ productId: 'p-chili', name: 'Chilipippuri Chipotle' }]
	},
	{ key: 'c', dish: 'x', label: 'nothing found', amount: '1 g per guest', candidates: [] }
];

describe('chooser', () => {
	it('keeps a pick from the list, a null as none, and treats a pick outside the list as none', async () => {
		const llm = scripted(() =>
			JSON.stringify({
				choices: [
					{ key: 'a', productId: 'p-sack', reason: 'whole onions', concern: null },
					{
						key: 'b',
						productId: 'p-made-up',
						reason: 'x',
						concern: 'adobo sauce is not chili powder'
					}
				]
			})
		);
		const got = await chooseProducts(llm, items);
		expect(got.get('a')).toEqual({ productId: 'p-sack', reason: 'whole onions' });
		expect(got.get('b')).toMatchObject({
			productId: null,
			concern: 'adobo sauce is not chili powder'
		});
		expect(got.has('c')).toBe(false);
		// Items without candidates are never sent.
		expect(llm.calls[0]).not.toContain('nothing found');
	});

	it('a failed or malformed answer leaves every item to the caller', async () => {
		expect(
			(
				await chooseProducts(
					scripted(() => 'not json'),
					items
				)
			).size
		).toBe(0);
	});
});

describe('proposal with a model: the chooser decides and its choice is remembered', () => {
	it('pins the chosen product, says why, keeps a refusal as unresolved and a concern as open', async () => {
		const env = await createDbPorts();
		const menu = {
			dishes: [
				{
					name: 'Root soup',
					course: 'soup',
					claimedCompatible: [],
					ingredients: [
						{ label: 'potato', query: 'peruna', amountPerCover: 120, unit: 'g' },
						{ label: 'carrot', query: 'porkkana', amountPerCover: 60, unit: 'g' }
					]
				}
			],
			open: []
		};
		let first = '';
		const llm = scripted(
			() => JSON.stringify(menu),
			(prompt) => {
				const sent = JSON.parse(prompt).items as { key: string; candidates: { id: string }[] }[];
				first = sent[0].candidates[0].id;
				return JSON.stringify({
					choices: [
						{ key: sent[0].key, productId: first, reason: 'raw potatoes', concern: null },
						{
							key: sent[1].key,
							productId: null,
							reason: 'only carrot dishes',
							concern: 'check the carrots'
						}
					]
				});
			}
		);
		const r = await proposeMenu({
			kitchenId: 'k-hotel',
			workspaceId: env.workspaceId,
			brief: {
				title: 'Soup lunch',
				date: '2026-12-10',
				guests: 10,
				serviceStyle: 'plated',
				courses: 1,
				dietary: [],
				provenance: { source: 'user' }
			},
			store: memoryMenuStore(),
			catalog: env.ports.catalog,
			now: new Date('2026-12-07T10:00:00Z'),
			llm
		});
		const [potato, carrot] = r.proposal.dishes[0].ingredients;
		expect(potato.productId).toBe(first);
		expect(potato.provenance.note).toContain('raw potatoes');
		expect(carrot.productId).toBeUndefined();
		expect(carrot.unresolved).toContain('only carrot dishes');
		expect(r.proposal.open.map((o) => o.id)).toContain(`fit:${carrot.id}`);
		// Marked as the chooser's pick, so the kitchen's next menu starts from it.
		expect(potato.pinnedBy).toBe('model');
		expect(carrot.pinnedBy).toBeUndefined();
	});

	const potatoes = (title: string) => ({
		title,
		date: '2026-12-10',
		guests: 4,
		serviceStyle: 'plated' as const,
		dietary: [],
		provenance: { source: 'user' as const }
	});
	const potatoMenu = () =>
		JSON.stringify({
			dishes: [
				{
					name: 'Potatoes',
					course: 'main',
					ingredients: [{ label: 'potato', query: 'peruna', amountPerCover: 200, unit: 'g' }]
				}
			]
		});

	it('a chef’s pin on an earlier menu answers before the resolver and the chooser', async () => {
		const env = await createDbPorts();
		const store = memoryMenuStore();
		const at = new Date('2026-12-07T10:00:00Z');
		const r1 = await proposeMenu({
			kitchenId: 'k-hotel',
			workspaceId: env.workspaceId,
			brief: potatoes('First'),
			store,
			catalog: env.ports.catalog,
			now: at
		});
		const ing = r1.proposal.dishes
			.flatMap((x) => x.ingredients)
			.find((x) => /potato/i.test(x.label))!;
		const found = await env.ports.catalog.resolve!('peruna', { limit: 3 });
		const pick =
			found.status === 'resolved'
				? (found.candidates.map((c) => c.productId).find((id) => id !== ing.productId) ??
					found.candidates[0].productId)
				: '';
		const pinned = await editMenu(
			{ workspaceId: env.workspaceId, store, catalog: env.ports.catalog, now: () => at },
			{
				id: r1.proposal.id,
				revision: 0,
				changes: [{ kind: 'pin', ingredientId: ing.id, productId: pick }]
			}
		);
		expect(pinned.ok).toBe(true);
		const llm = scripted(potatoMenu, () => JSON.stringify({ choices: [] }));
		const r = await proposeMenu({
			kitchenId: 'k-hotel',
			workspaceId: env.workspaceId,
			brief: potatoes('Second'),
			store,
			catalog: env.ports.catalog,
			now: at,
			llm
		});
		const i = r.proposal.dishes[0].ingredients[0];
		expect(i.productId).toBe(pick);
		expect(i.pinnedBy).toBe('chef');
		expect(i.provenance.note).toContain('chef pinned');
		// Nothing left to choose: the chooser was not called.
		expect(llm.calls.length).toBe(1);
		// Another kitchen doesn't see it.
		const elsewhere = await proposeMenu({
			kitchenId: 'k-lounas',
			workspaceId: env.workspaceId,
			brief: potatoes('Third'),
			store,
			catalog: env.ports.catalog,
			now: at
		});
		expect(elsewhere.proposal.dishes[0].ingredients[0].pinnedBy).toBeUndefined();
	});

	it('a brief’s hint names the product, remembered as the caller’s pin', async () => {
		const env = await createDbPorts();
		const found = await env.ports.catalog.resolve!('peruna', { limit: 3 });
		const pick = found.status === 'resolved' ? found.candidates.at(-1)!.productId : '';
		const r = await proposeMenu({
			kitchenId: 'k-hotel',
			workspaceId: env.workspaceId,
			brief: { ...potatoes('Hinted'), hints: [{ ingredient: 'potato', productId: pick }] },
			store: memoryMenuStore(),
			catalog: env.ports.catalog,
			now: new Date('2026-12-07T10:00:00Z'),
			llm: scripted(potatoMenu, () => JSON.stringify({ choices: [] })),
			by: { kind: 'external_agent', id: 'judge-x' }
		});
		const i = r.proposal.dishes[0].ingredients[0];
		expect(i.productId).toBe(pick);
		expect(i.pinnedBy).toBe('agent');
		expect(i.provenance.note).toContain('the caller named it');
	});
});
