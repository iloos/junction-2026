/**
 * Review F7: a routine order of four constrained products fits the 8-step cap. Every product gets its first search;
 * second search words are used only while the quote, the order and one spare step still fit.
 */
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { createHandlers } from '$lib/core/services/handlers';
import { createDbPorts } from '../store/db-ports';
import { runRoutineAgent } from './index';
import { MAX_STEPS } from './loop';

describe.skipIf(!existsSync('data/valio/valio_aimo_junction26_product_data.json'))(
	'step budget',
	() => {
		it('four constrained products are searched, quoted and ordered within the cap', async () => {
			const env = await createDbPorts();
			const run = await runRoutineAgent({
				goal: 'Order 4 kg lactose-free butter, 10 l lactose-free milk, 5 l lactose-free cream and 20 kg organic potatoes for k-lounas on Friday',
				env: { LLM_PROVIDER: 'fixture' },
				handlers: createHandlers(env.ports)
			});
			const tools = run.steps.map((s) => s.tool);
			expect(run.steps.length).toBeLessThanOrEqual(MAX_STEPS);
			expect(tools.filter((t) => t === 'search_products').length).toBeGreaterThanOrEqual(4);
			expect(tools).toContain('quote');
			expect(tools).toContain('place_order');
		}, 120_000);
	}
);
