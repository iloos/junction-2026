/** Read-only catalogue tools: search the static catalogue, quote live terms for known ids. */
import { ok, type Result, type ToolInput, type ToolOutput } from '../contracts';
import type { CallContext, Ports } from '../ports';
import { sortByPreference } from '../rank/presets';
import { defaultDeliverBy, scenarioDate } from '../scenario';

/** Helsinki calendar date of the simulator clock (deliverBy default). */
export const simToday = (ports: Ports): string => scenarioDate(ports.clock.now());

export async function searchProducts(
	ports: Ports,
	_ctx: CallContext,
	input: ToolInput<'search_products'>
): Promise<Result<ToolOutput<'search_products'>>> {
	// A chef's words (English, colloquial, a typo) are read as the catalogue's; the best few come with a confidence.
	if (ports.catalog.searchScored) {
		const s = await ports.catalog.searchScored(input.query, { limit: input.limit });
		return ok({
			products: input.rankBy ? sortByPreference(s.products, input.rankBy) : s.products,
			matches: s.hits,
			readAs: s.readAs,
			...(s.corrected ? { corrected: s.corrected } : {})
		});
	}
	const products = await ports.catalog.search(input.query, { limit: input.limit });
	return ok({ products: sortByPreference(products, input.rankBy) });
}

/**
 * Unknown ids are reported in `notFound` and never reach Valio (the catalog checks before calling). Without a
 * deliverBy the quote is for the scenario delivery, so its dates and cut-offs are December's, never the cache's.
 */
export async function quote(
	ports: Ports,
	_ctx: CallContext,
	input: ToolInput<'quote'>
): Promise<Result<ToolOutput<'quote'>>> {
	const ids = [...new Set(input.productIds)];
	return ok(await ports.catalog.offers(ids, input.deliverBy ?? defaultDeliverBy(simToday(ports))));
}
