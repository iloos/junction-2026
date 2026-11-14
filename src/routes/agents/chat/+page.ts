import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';

/** The agent lives in the app shell on every page now: open it over the Kitchen. */
export function load() {
	redirect(307, `${resolve('/')}?chat=1`);
}
