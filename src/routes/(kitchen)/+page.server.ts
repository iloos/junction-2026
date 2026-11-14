import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { roomLabel, roomNotice, visitorWorkspace } from '$lib/server/demo/visitor';
import type { PageServerLoad } from './$types';

/**
 * The page renders in the browser (`ssr = false`), but its load still runs here first: it honours `?ws=` from
 * an Operations deep link (or a shared sandbox link), so the kitchen API calls that follow act in that room.
 */
export const load: PageServerLoad = async (event) => {
	const v = await visitorWorkspace(event, env, dev, { follow: true });
	return {
		room: { workspaceId: v.workspaceId, kind: v.kind, label: roomLabel(v), notice: roomNotice(v) }
	};
};
