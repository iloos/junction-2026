import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { ownWorkspace } from '$lib/server/demo/visitor';
import { mintPairing } from '$lib/server/pair/pairing';
import { publicOrigin } from '$lib/server/tools/present';
import type { RequestHandler } from './$types';

const NO_STORE = { 'cache-control': 'no-store' };
const refuse = (status: number, message: string) =>
	json({ error: { code: 'FORBIDDEN', message } }, { status, headers: NO_STORE });

/**
 * Mint a one-time pairing for this browser's own sandbox (D17). Only the browser holding the sandbox's visitor cookie
 * may mint: a request carrying a key (an agent) is refused even with a cookie, and the request must come from this
 * origin. The link and code are returned to that browser only; no tool can reach this.
 */
export const POST: RequestHandler = async ({ request, cookies, url }) => {
	if (request.headers.has('authorization'))
		return refuse(403, 'Pairing is for a person, not a key.');
	const origin = request.headers.get('origin');
	if (!origin || origin !== url.origin) return refuse(403, 'Pairing must come from this page.');
	const ws = ownWorkspace(cookies, env);
	if (!ws) return refuse(403, 'Open this from the browser that has your sandbox.');
	const p = mintPairing(ws);
	if (!p) return refuse(403, 'Only your own sandbox can be opened on another device.');
	const link = `${publicOrigin(env, request.url)}/pair/t/${p.token}`;
	return json(
		{
			code: p.code,
			link,
			expiresAt: new Date(p.expiresAt).toISOString()
		},
		{ headers: NO_STORE }
	);
};
