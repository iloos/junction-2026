import { json } from '@sveltejs/kit';
import { recordedListing } from '$lib/server/products/card';
import type { RequestHandler } from './$types';

/**
 * GET /kitchen-api/thumbs?ids=a,b,c: product photos for the rows on screen, in one read. Only listings already known
 * (prewarmed or cached by the plan-time prefetch); never a live lookup, so a page full of rows costs nothing.
 * `null` means no photo is known: the row shows its placeholder.
 */
export const GET: RequestHandler = async ({ url }) => {
	const ids = (url.searchParams.get('ids') ?? '')
		.split(',')
		.filter((id) => /^\d{4,10}$/.test(id))
		.slice(0, 200);
	const out: Record<string, { imageUrl: string; match: string } | null> = {};
	for (const id of ids) {
		const l = recordedListing(id) as
			(ReturnType<typeof recordedListing> & { match?: string }) | null | undefined;
		out[id] = l?.imageUrl ? { imageUrl: l.imageUrl, match: l.match ?? l.verifiedBy } : null;
	}
	return json(out, { headers: { 'cache-control': 'private, max-age=300' } });
};
