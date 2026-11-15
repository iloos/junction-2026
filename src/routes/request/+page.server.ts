import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { actors, DEFAULT_KITCHEN, kitchens, llmKind, simNow, simToday } from '$lib/server/request';
import { roomLabel, roomNotice, visitorWorkspace } from '$lib/server/demo/visitor';
import { visitorKey } from '$lib/server/kitchen/live';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const v = await visitorWorkspace(event, env, dev, { follow: true });
	const ctx = (await actors(env, v.workspaceId)).agent;
	// The visitor's own stores first; in a room others share (D24), only theirs: the chat acts for nothing else there.
	const mine = visitorKey(v.own);
	const shared = v.kind === 'shared' || v.kind === 'full' || (v.kind === 'stage' && !v.presenter);
	const all = await kitchens(ctx);
	const own = all.filter((k) => k.owner === mine);
	const list = shared ? own : [...own, ...all.filter((k) => k.owner !== mine && !k.owner)];
	return {
		today: await simToday(v.workspaceId),
		now: await simNow(v.workspaceId),
		parser: llmKind(env),
		workspace: {
			id: v.workspaceId,
			stage: v.kind === 'stage',
			kind: v.kind,
			label: roomLabel(v),
			notice: roomNotice(v),
			run: ctx.runId
		},
		defaultKitchen: own[0]?.id ?? (shared ? '' : DEFAULT_KITCHEN),
		/** In a shared room without a store of one's own: the page says to start one first. */
		needsStore: shared && !own.length,
		kitchens: list.map((k) => ({
			id: k.id,
			name: k.name,
			mandateWords: k.mandate.words,
			lineCapCents: k.mandate.lineCapCents,
			orderCapCents: k.mandate.orderCapCents,
			weeklyCapCents: k.mandate.weeklyCapCents
		}))
	};
};
