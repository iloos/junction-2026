/**
 * D15 stage 2 / S5 D23 finding: the same words pick the same products on /request and in the chat (the routine run).
 * Both rank with filterHits and order candidates with one comparator (rankOrder: fit to the ask, score, id).
 */
import { describe, expect, it } from 'vitest';
import { playText } from '../evals/fidelity';

const products = (p: Awaited<ReturnType<typeof playText>>) =>
	[
		...new Set(
			p.plans.flatMap((x) => x.lines.filter((l) => l.qty.value > 0).map((l) => l.productId))
		)
	].sort();

describe('one reading, both doors', () => {
	for (const text of [
		'20 l lactose-free milk and 5 kg butter for friday',
		'5 kg butter for friday',
		'10 kg potatoes and 5 l cream for friday'
	])
		it(`"${text}" picks the same products`, { timeout: 180_000 }, async () => {
			const page = await playText('k-hotel', text, 'request', 'door-page');
			const chat = await playText('k-hotel', text, 'agent', 'door-chat');
			expect(products(chat)).toEqual(products(page));
			expect(products(page).length).toBeGreaterThan(0);
		});
});

import { createDbPorts } from '../store/db-ports';
import { filterHits, rankOrder } from '../request/lookup';
import { parseRules } from '../request/parse';
import { routineCandidates } from '../agent/routine';

describe('the chat merges candidates in /request order', () => {
	it(
		'"5 kg butter": fit to the ask before score, as /request ranks',
		{ timeout: 60_000 },
		async () => {
			const env = await createDbPorts({ now: '2026-12-07T09:00:00+02:00' });
			const [item] = parseRules('5 kg butter for friday', '2026-12-07').items;
			const hits = await env.ports.catalog.search('voi', { limit: 50 });
			const page = filterHits(item, hits).ranked.map((r) => r.product.productId);
			const line = { query: item.query, qty: item.qty!, unit: item.unit as 'kg', item };
			// Hits in reverse, as another search order would return them: the merge must not depend on it.
			const merged = routineCandidates(line, [...hits].reverse())
				.products.sort(rankOrder)
				.map((c) => c.productId);
			expect(merged).toEqual(page.slice(0, merged.length));
		}
	);
});
