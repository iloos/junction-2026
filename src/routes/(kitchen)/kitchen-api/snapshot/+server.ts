import { json } from '@sveltejs/kit';
import { snapshot } from '$lib/server/kitchen/live';
import type { RequestHandler } from './$types';

/** Everything the kitchen screen renders, from the real plan (live mode). */
export const GET: RequestHandler = async () => json(await snapshot());
