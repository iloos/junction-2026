/**
 * The product card for a caller (the keyless kitchen helper today): Valio terms through the app's catalogue port,
 * the public listing live (Exa + the public page, charged to the visitor's web cap) when the web lane is live, else the
 * recorded set.
 */
import type { CallContext } from '$lib/core/ports';
import { createWebHttp } from '../web/http';
import { cacheDir, findingsFor, spendLedger, webContext, webMode, webPg } from '../web';
import { spendLimits } from '../web/spend';
import { createListingFinder } from '../web/listing';
import { productCard, recordedListing, type ProductCard } from './card';
import type { Product } from '$lib/core/contracts';
import type { ProductListing } from '../web/listing';
import { join } from 'node:path';

type Env = Record<string, string | undefined>;

/** The live finder for a caller (its web cap), or undefined when the web lane is in fixture mode. */
export function listingFinder(env: Env, spendKey: string) {
	if (webMode(env) !== 'live' || !env.EXA_API_KEY) return undefined;
	const guard = spendLedger(env).guard(spendKey, spendLimits(env));
	return createListingFinder({
		exa: createWebHttp({
			api: 'exa',
			apiKey: env.EXA_API_KEY,
			cacheDir: join(cacheDir(env), 'exa'),
			store: webPg()?.cache,
			guard
		}),
		store: webPg()?.cache,
		findings: findingsFor(env),
		guard
	});
}

/** A product's verified public page: prewarmed for the demo set, else live (when live), else none. */
export async function listingOf(
	env: Env,
	spendKey: string,
	p: Product
): Promise<ProductListing | null> {
	const kept = recordedListing(p.productId);
	if (kept !== undefined) return kept;
	return (await listingFinder(env, spendKey)?.(p).catch(() => null)) ?? null;
}

export async function cardFor(
	env: Env,
	ctx: CallContext,
	productId: string,
	deliverBy: string
): Promise<ProductCard | null> {
	const w = await webContext(ctx);
	return productCard(productId, {
		catalog: w.ports.catalog,
		deliverBy,
		listing: listingFinder(env, `visitor:${ctx.workspaceId}`)
	});
}
