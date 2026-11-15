/**
 * Mixed-diet splits ("120 guests, half vegetarian", "50/50 meat and fish", "20 vegan, 40 vegetarian, 60 the rest"):
 * a dish for some of the guests is sized for them only, and a course's parts must add up to the guests.
 */
import { describe, expect, it } from 'vitest';
import type { EventBrief, MenuProposal } from '$lib/core/contracts';
import { menuDemand } from '$lib/core/demand/menu';
import type { Llm } from '$lib/core/ports';
import { createDbPorts } from '../store/db-ports';
import { proposeMenu } from './proposal';
import { reviewProposal } from './rubric';
import { memoryMenuStore } from './store';

const brief = (guests: number, dietary: string[] = []): EventBrief =>
	({
		title: 'Split',
		date: '2026-12-11',
		guests,
		serviceStyle: 'plated',
		courses: 1,
		dietary,
		provenance: { source: 'user' }
	}) as EventBrief;

/** A one-course proposal: [name, guests?, claims][]; each dish has 150 g of one ingredient. */
const proposal = (b: EventBrief, dishes: [string, number | undefined, string[]][]): MenuProposal =>
	({
		id: 'm-split',
		revision: 0,
		kitchenId: 'k-hotel',
		status: 'chef_reviewed',
		brief: b,
		open: [],
		provenance: { source: 'llm' },
		dishes: dishes.map(([name, guests, claims], i) => ({
			id: `d-${i}`,
			name,
			course: 'main',
			claimedCompatible: claims,
			...(guests ? { guests } : {}),
			ingredients: [
				{
					id: `d-${i}.i`,
					label: name,
					query: name,
					amountPerCover: 150,
					unit: 'g',
					provenance: { source: 'llm' }
				}
			],
			provenance: { source: 'llm' }
		}))
	}) as unknown as MenuProposal;

const kgFor = (p: MenuProposal) => menuDemand(p).map((n) => n.need.amount.value);
const splitIssues = (b: EventBrief, p: MenuProposal) =>
	reviewProposal(b, p).filter((i) => i.id.startsWith('split:'));

describe('per-dish guests', () => {
	it('120 guests, half vegetarian: each main is sized for its 60', () => {
		const b = brief(120, ['vegetarian:60']);
		const p = proposal(b, [
			['kasvispihvi', 60, ['vegetarian:60']],
			['naudanliha', 60, []]
		]);
		expect(kgFor(p)).toEqual([9, 9]);
		expect(splitIssues(b, p)).toEqual([]);
	});

	it('50/50 meat and fish for 80: 40 each, and parts that miss guests block', () => {
		const b = brief(80);
		const ok = proposal(b, [
			['lohifilee', 40, []],
			['broileri', 40, []]
		]);
		expect(kgFor(ok)).toEqual([6, 6]);
		expect(splitIssues(b, ok)).toEqual([]);
		const short = proposal(b, [
			['lohifilee', 40, []],
			['broileri', 30, []]
		]);
		const issues = splitIssues(b, short);
		expect(issues).toHaveLength(1);
		expect(issues[0].severity).toBe('block');
		expect(issues[0].text).toContain('70 guests');
	});

	it('20 vegan, 40 vegetarian, 60 the rest: three mains, three sizes', () => {
		const b = brief(120, ['vegan:20', 'vegetarian:40']);
		const p = proposal(b, [
			['tofu', 20, ['vegan:20']],
			['halloumi', 40, ['vegetarian:40']],
			['porsaanfilee', 60, []]
		]);
		expect(kgFor(p)).toEqual([3, 6, 9]);
		expect(splitIssues(b, p)).toEqual([]);
	});

	it('a menu without splits is sized for every guest, as before', () => {
		const b = brief(100);
		const p = proposal(b, [['peruna', undefined, []]]);
		expect(kgFor(p)).toEqual([15]);
		expect(splitIssues(b, p)).toEqual([]);
	});

	it('the model’s per-dish guests reach the proposal', async () => {
		const env = await createDbPorts();
		const llm: Llm = {
			async generate(req) {
				const text = req.prompt.startsWith('Brief:')
					? JSON.stringify({
							dishes: [
								{
									name: 'Kasvispihvi',
									course: 'main',
									claimedCompatible: ['vegetarian:60'],
									guests: 60,
									ingredients: [{ label: 'beans', query: 'papu', amountPerCover: 150, unit: 'g' }]
								},
								{
									name: 'Naudanpihvi',
									course: 'main',
									guests: 60,
									ingredients: [{ label: 'beef', query: 'naudan', amountPerCover: 150, unit: 'g' }]
								}
							],
							open: []
						})
					: JSON.stringify({ choices: [] });
				return { text, model: 'stub', tokens: { in: 1, out: 1 }, latencyMs: 1 };
			}
		};
		const r = await proposeMenu({
			kitchenId: 'k-hotel',
			workspaceId: env.workspaceId,
			brief: brief(120, ['vegetarian:60']),
			store: memoryMenuStore(),
			catalog: env.ports.catalog,
			now: new Date('2026-12-07T10:00:00Z'),
			llm
		});
		expect(r.proposal.dishes.map((d) => d.guests)).toEqual([60, 60]);
		expect(r.issues.filter((i) => i.id.startsWith('split:'))).toEqual([]);
	});
});
