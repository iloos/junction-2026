import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { actors, DEFAULT_KITCHEN, kitchens, llmKind, simNow, simToday } from '$lib/server/request';
import { roomLabel, visitorWorkspace } from '$lib/server/demo/visitor';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const v = await visitorWorkspace(event, env, dev, { follow: true });
	const ctx = (await actors(env, v.workspaceId)).agent;
	const list = await kitchens(ctx);
	return {
		today: await simToday(),
		now: await simNow(),
		parser: llmKind(env),
		workspace: {
			id: v.workspaceId,
			stage: v.kind === 'stage',
			kind: v.kind,
			label: roomLabel(v),
			run: ctx.runId
		},
		defaultKitchen: DEFAULT_KITCHEN,
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
