import { json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { visitorWorkspace } from '$lib/server/demo/visitor';
import { allowMint, mintKey } from '$lib/server/stt/soniox';
import type { RequestHandler } from './$types';

/**
 * Voice input (chat-harness §1c). GET says whether voice is on (the mic shows only then); POST mints a short-lived
 * Soniox key for one dictation, rate-limited per visitor. The account key stays in the server env.
 */
export const GET: RequestHandler = async () =>
	json({ enabled: !!env.SONIOX_API_KEY }, { headers: { 'cache-control': 'private, max-age=300' } });

export const POST: RequestHandler = async (event) => {
	const key = env.SONIOX_API_KEY;
	if (!key) return json({ error: { message: 'Voice input is off' } }, { status: 404 });
	const { workspaceId } = await visitorWorkspace(event, env, dev);
	if (!allowMint(workspaceId))
		return json(
			{ error: { message: 'Too many voice sessions; try again in a few minutes' } },
			{ status: 429 }
		);
	const out = await mintKey(key, workspaceId);
	if (!out.ok) return json({ error: { message: out.message } }, { status: out.status });
	return json(
		{ apiKey: out.apiKey, expiresAt: out.expiresAt, url: out.url },
		{ headers: { 'cache-control': 'no-store' } }
	);
};
