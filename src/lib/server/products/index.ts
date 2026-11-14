/**
 * The product card for a caller (the keyless kitchen helper today): Valio terms through the app's catalogue port,
 * the public listing live (Exa + the public page, charged to the visitor's web cap) when the web lane is live, else the
 * recorded set.
 */
import type { CallContext } from '$lib/core/ports';
import { createWebHttp } from '../web/http';
import { cacheDir, spendLedger, webContext, webMode, webPg } from '../web';
import { spendLimits } from '../web/spend';
import { createListingFinder } from '../web/listing';
import { productCard, type ProductCard } from './card';
import { join } from 'node:path';

type Env = Record<string, string | undefined>;

export async function cardFor(
	env: Env,
	ctx: CallContext,
	productId: string,
	deliverBy: string
): Promise<ProductCard | null> {
	const w = await webContext(ctx);
	const live = webMode(env) === 'live' && env.EXA_API_KEY;
	const spendKey = `visitor:${ctx.workspaceId}`;
	const guard = spendLedger(env).guard(spendKey, spendLimits(env));
	const find = live
		? createListingFinder({
				exa: createWebHttp({
					api: 'exa',
					apiKey: env.EXA_API_KEY!,
					cacheDir: join(cacheDir(env), 'exa'),
					store: webPg()?.cache,
					guard
				}),
				store: webPg()?.cache,
				guard
			})
		: undefined;
	return productCard(productId, { catalog: w.ports.catalog, deliverBy, listing: find });
}
