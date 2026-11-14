import { json } from '@sveltejs/kit';
import { scenario } from '$lib/server/kitchen/live';
import type { RequestHandler } from './$types';

/** Demo controls: rule preset, kitchen, simulated contention, reset. Returns the new snapshot. */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as { action?: string; value?: unknown };
	try {
		return json(await scenario(body.action ?? '', body.value));
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		return json({ error: { code: 'INVALID_INPUT', message, retryable: false } }, { status: 400 });
	}
};
