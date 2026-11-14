import { json } from '@sveltejs/kit';
import { Cooldown, scenario } from '$lib/server/kitchen/live';
import { sid } from '$lib/server/kitchen/sid';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { visitorWorkspace } from '$lib/server/demo/visitor';
import type { RequestHandler } from './$types';

/** Demo commands: start (plans the event), rule preset, kitchen, simulated contention, reset. Returns the snapshot. */
export const POST: RequestHandler = async (event) => {
	const { request, cookies } = event;
	const { workspaceId, own, kind, presenter } = await visitorWorkspace(event, env, dev);
	const body = (await request.json().catch(() => ({}))) as {
		action?: string;
		value?: unknown;
		plan?: string;
	};
	try {
		return json(
			await scenario(sid(cookies), workspaceId, body.action ?? '', body.value, body.plan, {
				own,
				kind,
				presenter
			})
		);
	} catch (e) {
		if (e instanceof Cooldown)
			return json(
				{
					error: {
						code: 'PROVIDER_UNAVAILABLE',
						message: e.message,
						retryable: true,
						detail: { retryInMs: e.retryInMs }
					}
				},
				{ status: 429 }
			);
		const message = e instanceof Error ? e.message : String(e);
		return json({ error: { code: 'INVALID_INPUT', message, retryable: false } }, { status: 400 });
	}
};
