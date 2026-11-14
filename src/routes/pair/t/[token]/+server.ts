import { redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { openSandbox } from '$lib/server/pair/cookies';
import { redeemToken } from '$lib/server/pair/pairing';
import type { RequestHandler } from './$types';

/** The QR code's link: single use. It opens the sandbox on this device and lands on the kitchen. */
export const GET: RequestHandler = ({ params, cookies, setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store' });
	const r = redeemToken(params.token);
	if (!r.ok) redirect(303, '/pair?expired=1');
	openSandbox(cookies, r.workspaceId, env);
	redirect(303, '/?paired=1');
};
