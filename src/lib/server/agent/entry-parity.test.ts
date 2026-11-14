/**
 * Review F2: the same words through /request and through the routine agent keep the same hard asks. The agent's
 * filter rejects what the request page rejects (a vegan ask against milk butter, a brand ask against another brand),
 * and both build the same order line: the ask as stated and the requirements travel to the need.
 */
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Product } from '$lib/core/contracts';
import { loadCatalogue } from '../adapters/catalog/valio';
import { filterHits } from '../request/lookup';
import { orderLineFor } from '../request/order-line';
import { parseRules } from '../request/parse';
import { SUPPORTED_EVENTS } from './context';
import { resolveIntent } from './intent';
import { routineCandidates, routineItem, routineLines } from './routine';
import type { AgentContext } from './types';

const DIR = join('data', 'valio');
const ctx: AgentContext = {
	kitchens: [{ id: 'k-lounas', name: 'Lounas' }],
	currentPlan: null,
	openPlans: [],
	supportedEvents: SUPPORTED_EVENTS,
	supportedIntents: ['routine_order', 'seeded_event', 'shortage_repair', 'inspect'],
	today: '2026-11-14'
};

/** The agent's reading of a goal, as its loop sees each product. */
function agentLine(goal: string) {
	const r = resolveIntent(`${goal} for k-lounas`, ctx);
	if (r.kind !== 'routine_order') throw new Error(`not a routine order: ${r.kind}`);
	return routineLines(r)[0];
}

describe.skipIf(!existsSync(join(DIR, 'valio_aimo_junction26_product_data.json')))(
	'one request, every entry',
	() => {
		const cat = existsSync(join(DIR, 'valio_aimo_junction26_product_data.json'))
			? loadCatalogue(DIR)
			: new Map();
		const p = (id: string) => cat.get(id) as Product;
		const BUTTER = p('463798'); // Valio voi 200 g: milk, vegetarian record
		const ARLA = p('463744'); // Arla laktoositon meijerivoi

		it.each([
			['4 kg vegan butter tomorrow', BUTTER],
			['4 kg Arla butter tomorrow', BUTTER]
		])('%s: the agent rejects what /request rejects', (goal, product) => {
			const item = parseRules(goal, ctx.today).items[0];
			const page = filterHits(item, [product]);
			const agent = routineCandidates(agentLine(goal), [product]);
			expect(page.ranked.map((r) => r.product.productId)).toEqual([]);
			expect(agent.products.map((c) => c.productId)).toEqual([]);
			expect(agent.rejected).toBe(page.rejected.length);
		});

		it('the brand ask still finds its brand through the agent', () => {
			const goal = '4 kg Arla butter tomorrow';
			const agent = routineCandidates(agentLine(goal), [ARLA, BUTTER]);
			expect(agent.products.map((c) => c.productId)).not.toContain(BUTTER.productId);
		});

		it('both entries build the same order line: ask and requirements on the need', () => {
			const goal = '4 kg lactose-free butter tomorrow';
			const item = parseRules(goal, ctx.today).items[0];
			const line = agentLine(goal);
			const pick = { productId: '463437', salesQty: 8, salesUnit: 'ST' };
			const viaRequest = orderLineFor(item, pick);
			const viaAgent = orderLineFor(routineItem(line), pick);
			expect(viaAgent.requirements).toEqual(viaRequest.requirements);
			expect(viaAgent.requirements?.freeFrom).toContain('LACTOSE');
			expect(viaAgent.ask).toEqual(viaRequest.ask);
			expect(viaAgent.amount).toEqual({ value: 4, unit: 'kg' });
		});
	}
);
