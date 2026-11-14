import { env } from '$env/dynamic/private';
import { actors, DEFAULT_KITCHEN, kitchens, llmKind, simToday } from '$lib/server/request';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const ctx = actors(env).agent;
	const list = await kitchens(ctx);
	return {
		today: await simToday(),
		parser: llmKind(env),
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
