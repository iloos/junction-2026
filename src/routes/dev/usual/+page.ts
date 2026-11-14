import { error } from '@sveltejs/kit';
import { dev } from '$app/environment';
import type { PageLoad } from './$types';

/** Dev-only preview of the usual-order panel: /dev/usual?kitchen=k-hotel&date=2026-12-10. */
export const load: PageLoad = ({ url }) => {
	if (!dev) error(404, 'Not found');
	return {
		kitchen: url.searchParams.get('kitchen') ?? 'k-hotel',
		date: url.searchParams.get('date') ?? undefined
	};
};
