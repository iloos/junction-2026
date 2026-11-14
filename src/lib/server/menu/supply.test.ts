/**
 * Hero journey: a menu ingredient gets a product Valio can deliver. Among the resolver's matches for the same food,
 * an undeliverable or sold-out first match gives way to one that can come, and the menu says so in one line.
 */
import { describe, expect, it } from 'vitest';
import type { Catalog } from '$lib/core/ports';
import { trialWorkspace } from '../agent/trial-harness';
import { FIDELITY_NOW } from '../evals/fidelity';
import { applyBriefAnswers, draftBrief, toEventBrief } from './brief';
import { proposeMenu } from './proposal';

describe('menu picks by supply', () => {
	it(
		'the first match that cannot be delivered gives way, with a one-line note',
		{ timeout: 120_000 },
		async () => {
			const w = await trialWorkspace();
			const real = w.env.ports.catalog;
			const t = 'a no-meat dinner for 120 with a peach dessert on Sat 12 Dec, buffet';
			const b = toEventBrief(
				applyBriefAnswers(
					draftBrief(t, '2026-12-07'),
					[{ id: 'brief.budget', value: 0 }],
					'2026-12-07'
				),
				t
			)!;
			const base = {
				kitchenId: 'k-hotel',
				workspaceId: w.env.workspaceId,
				brief: b,
				store: w.env.ports.menus!,
				now: new Date(FIDELITY_NOW)
			};
			// Without supply: the resolver's own first match for the mushrooms.
			const plain = await proposeMenu({
				...base,
				catalog: { resolve: real.resolve!.bind(real), get: real.get.bind(real) },
				nonce: 'a'
			});
			const mush = (p: typeof plain) =>
				p.proposal.dishes.flatMap((x) => x.ingredients).find((i) => i.label === 'mushrooms')!;
			const first = mush(plain).productId!;
			// With supply: that product can't be delivered, everything else is in stock.
			const offers: Catalog['offers'] = async (ids) => ({
				offers: ids.map((productId) => ({
					productId,
					price: null,
					availability:
						productId === first
							? { kind: 'undeliverable' as const, amount: null }
							: { kind: 'known' as const, amount: 1000 }
				})) as never,
				notFound: []
			});
			const ranked = await proposeMenu({
				...base,
				catalog: { resolve: real.resolve!.bind(real), get: real.get.bind(real), offers },
				nonce: 'b'
			});
			expect(mush(ranked).productId).not.toBe(first);
			expect(
				ranked.proposal.open.find((o) => o.id.startsWith('supply:') && /mushrooms/.test(o.text))
					?.text
			).toMatch(/can't be delivered that day; .+ instead/);
		}
	);
});
