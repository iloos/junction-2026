import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import {
	actors,
	DEFAULT_KITCHEN,
	kitchens,
	llmKind,
	pageWorkspace,
	simNow,
	simToday
} from '$lib/server/request';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const ws = pageWorkspace(env, dev);
	const ctx = (await actors(env, ws.id)).agent;
	const list = await kitchens(ctx);
	return {
		today: await simToday(),
		now: await simNow(),
		parser: llmKind(env),
		workspace: { id: ws.id, stage: ws.stage, run: ctx.runId },
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
