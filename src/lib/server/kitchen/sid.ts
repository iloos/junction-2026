import type { Cookies } from '@sveltejs/kit';

/** A browser session id for the kitchen screen's selection (kitchen, preset). Not an identity, not an authority. */
export function sid(cookies: Cookies): string {
	let id = cookies.get('kitchen_sid');
	if (!id) {
		id = crypto.randomUUID();
		cookies.set('kitchen_sid', id, {
			path: '/',
			httpOnly: true,
			sameSite: 'strict',
			maxAge: 60 * 60 * 24
		});
	}
	return id;
}
