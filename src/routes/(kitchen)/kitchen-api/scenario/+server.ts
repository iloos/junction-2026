import { json } from '@sveltejs/kit';
import { scenario } from '$lib/server/kitchen/live';
import { sid } from '$lib/server/kitchen/sid';
import type { RequestHandler } from './$types';

/** Demo commands: start (plans the event), rule preset, kitchen, simulated contention, reset. Returns the snapshot. */
export const POST: RequestHandler = async ({ request, cookies }) => {
	const body = (await request.json().catch(() => ({}))) as { action?: string; value?: unknown };
	try {
		return json(await scenario(sid(cookies), body.action ?? '', body.value));
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		return json({ error: { code: 'INVALID_INPUT', message, retryable: false } }, { status: 400 });
	}
};
