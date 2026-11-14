import { fail, redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { openSandbox } from '$lib/server/pair/cookies';
import { redeemCode } from '$lib/server/pair/pairing';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url, setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store' });
	return { expired: url.searchParams.has('expired') };
};

/** A typed code: single use; a client that misses a few times waits out the window. */
export const actions: Actions = {
	default: async ({ request, cookies, getClientAddress }) => {
		const code = String((await request.formData()).get('code') ?? '');
		const r = redeemCode(code, getClientAddress());
		if (!r.ok)
			return fail(r.reason === 'limited' ? 429 : 400, {
				message:
					r.reason === 'limited'
						? `Too many tries. Wait ${Math.ceil((r.retryInMs ?? 60_000) / 60_000)} min, or scan the QR code instead.`
						: 'That code is not valid any more. Codes work once, for 10 minutes; make a new one on the other device.'
			});
		openSandbox(cookies, r.workspaceId, env);
		redirect(303, '/?paired=1');
	}
};
