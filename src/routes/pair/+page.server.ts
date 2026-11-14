import { fail, redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { openSandbox } from '$lib/server/pair/cookies';
import { redeemCode } from '$lib/server/pair/pairing';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url, setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store' });
	return { expired: url.searchParams.has('expired') };
};

/** A typed code: single use; many misses pause typed codes (the QR link keeps working). */
export const actions: Actions = {
	default: async ({ request, cookies, getClientAddress }) => {
		const code = String((await request.formData()).get('code') ?? '');
		const r = redeemCode(code, getClientAddress());
		if (!r.ok)
			return fail(r.reason === 'unknown' ? 400 : 429, {
				message:
					r.reason === 'unknown'
						? 'That code is not valid any more. Codes work once, for 10 minutes; make a new one on the other device.'
						: `Typed codes are paused for ${Math.ceil((r.retryInMs ?? 60_000) / 60_000)} min after too many wrong tries. Scan the QR code on the other device instead.`
			});
		openSandbox(cookies, r.workspaceId, env);
		redirect(303, '/?paired=1');
	}
};
