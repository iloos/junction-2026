import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { photosFor } from '$lib/server/products/photos';
import { createServerPorts } from '$lib/server/store/server-ports';
import type { RequestHandler } from './$types';

/**
 * GET /kitchen-api/thumbs?ids=a,b,c: the photo ladder for the rows on screen, in one read (S4's photosFor: the
 * product's own photo, its family's, its brand's, or a category icon). Known data only, never a live lookup, so a page
 * full of rows costs nothing; plans warm the photos when they are made.
 */
export const GET: RequestHandler = async ({ url }) => {
	const ids = (url.searchParams.get('ids') ?? '')
		.split(',')
		.filter((id) => /^\d{4,10}$/.test(id))
		.slice(0, 200);
	if (!ids.length) return json({});
	const { ports } = await createServerPorts();
	const photos = await photosFor(env, ports.catalog, ids);
	return json(photos, { headers: { 'cache-control': 'private, max-age=120' } });
};
