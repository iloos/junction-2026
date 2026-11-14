import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { roomLabel, roomNotice, visitorWorkspace } from '$lib/server/demo/visitor';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const v = await visitorWorkspace(event, env, dev, { follow: true });
	return {
		room: { workspaceId: v.workspaceId, kind: v.kind, label: roomLabel(v), notice: roomNotice(v) }
	};
};
