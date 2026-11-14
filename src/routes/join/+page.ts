import { error } from '@sveltejs/kit';
import { dev } from '$app/environment';

/** A dev-only preview of the establishment picker (D15) until the home state machine mounts it. */
export const load = () => {
	if (!dev) error(404, 'Not found');
	return {};
};
