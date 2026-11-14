import { json } from '@sveltejs/kit';
import { snapshot } from '$lib/server/kitchen/live';
import { sid } from '$lib/server/kitchen/sid';
import type { RequestHandler } from './$types';

/** Everything the kitchen screen renders, from the real plan. A read: it never plans or proposes. */
export const GET: RequestHandler = async ({ cookies }) => json(await snapshot(sid(cookies)));
