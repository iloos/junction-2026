/**
 * The product card for a caller (the keyless kitchen helper today): Valio terms through the app's catalogue port,
 * the public listing live (Exa + the public page, charged to the visitor's web cap) when the web lane is live, else the
 * recorded set.
 */
import type { CallContext } from '$lib/core/ports';
import { createWebHttp } from '../web/http';
import { cacheDir, findingsFor, spendLedger, webContext, webMode, webPg } from '../web';
import { spendLimits, type SpendLimits } from '../web/spend';
import { createListingFinder } from '../web/listing';
import { createBrandLookup, type BrandFacts } from '../web/photo';
import type { WebCall } from '../web/http';
import { productCard, recordedListing, type ProductCard } from './card';
import type { Product } from '$lib/core/contracts';
import type { ProductListing } from '../web/listing';
import { join } from 'node:path';

type Env = Record<string, string | undefined>;

/** Context.dev for a caller (its web cap), or undefined in fixture mode or without a key. */
function contextDevCall(env: Env, spendKey: string, limits?: SpendLimits): WebCall | undefined {
	if (webMode(env) !== 'live' || !env.CONTEXT_DEV_API_KEY) return undefined;
	return createWebHttp({
		api: 'context.dev',
		apiKey: env.CONTEXT_DEV_API_KEY,
		cacheDir: join(cacheDir(env), 'context-dev'),
		store: webPg()?.cache,
		guard: spendLedger(env).guard(spendKey, limits ?? spendLimits(env))
	});
}

/**
 * A brand's domain and logo (Context.dev), kept as a finding (`brand:<name>`) so cached reads (row photos) can use it
 * without a call. Undefined in fixture mode.
 */
export function brandLookup(env: Env, spendKey: string, limits?: SpendLimits) {
	const cd = contextDevCall(env, spendKey, limits);
	if (!cd) return undefined;
	const live = createBrandLookup(cd);
	const findings = findingsFor(env);
	return async (name: string): Promise<BrandFacts> => {
		const id = `brand:${name.trim().toLowerCase()}`;
		const kept = findings.get(id)?.data as BrandFacts | undefined;
		if (kept) return kept;
		const b = await live(name);
		findings.put({
			id,
			kind: 'listing',
			at: new Date().toISOString(),
			title: `Brand ${name}`,
			sources: b.domain ? [`https://${b.domain}`] : [],
			data: b
		});
		return b;
	};
}

/** The live finder for a caller (its web cap), or undefined when the web lane is in fixture mode. */
export function listingFinder(env: Env, spendKey: string, limits?: SpendLimits) {
	if (webMode(env) !== 'live' || !env.EXA_API_KEY) return undefined;
	const guard = spendLedger(env).guard(spendKey, limits ?? spendLimits(env));
	const brand = brandLookup(env, spendKey, limits);
	return createListingFinder({
		exa: createWebHttp({
			api: 'exa',
			apiKey: env.EXA_API_KEY,
			cacheDir: join(cacheDir(env), 'exa'),
			store: webPg()?.cache,
			guard
		}),
		contextdev: contextDevCall(env, spendKey, limits),
		...(brand ? { brandDomain: async (name: string) => (await brand(name)).domain } : {}),
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
	const card = await productCard(productId, {
		catalog: w.ports.catalog,
		deliverBy,
		listing: listingFinder(env, `visitor:${ctx.workspaceId}`)
	});
	if (!card) return null;
	// After the card's own lookup, so a page it just found is known to the ladder.
	const { photosFor } = await import('./photos');
	const photo = (await photosFor(env, w.ports.catalog, [productId]))[productId];
	return photo ? { ...card, photo } : card;
}
