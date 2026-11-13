import kitchenSeed from '../../../fixtures/seeds/kitchens.json';
import buffetSeed from '../../../fixtures/seeds/christmas-buffet-140.json';
import { SYNTH_PRODUCTS, SYNTH_WORKSPACE } from '$lib/server/bus/synthetic';
import { fail } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { startAgentRun } from '$lib/server/bus/agent-runs';
import type { Actions, PageServerLoad } from './$types';

export type OpsKitchen = {
	id: string;
	name: string;
	kind: string;
	city: string;
	mandateWords: string;
	weeklyCapCents: number;
};

/** productId → name from the seeds; the catalog port replaces this once core-db serves names. */
function seedNames(): Record<string, string> {
	const out: Record<string, string> = {};
	const walk = (o: unknown) => {
		if (Array.isArray(o)) o.forEach(walk);
		else if (o && typeof o === 'object') {
			const r = o as Record<string, unknown>;
			if (typeof r.productId === 'string' && typeof r.productName === 'string')
				out[r.productId] = r.productName;
			Object.values(r).forEach(walk);
		}
	};
	walk(buffetSeed);
	return out;
}

const names = { ...seedNames(), ...SYNTH_PRODUCTS };
const kitchens: OpsKitchen[] = kitchenSeed.kitchens.map((k) => ({
	id: k.id,
	name: k.name.replace(/\s*\(fictional\)$/, ''),
	kind: k.kind,
	city: k.city,
	mandateWords: k.mandate.words,
	weeklyCapCents: k.mandate.weeklyCapCents
}));

export const load: PageServerLoad = ({ url }) => {
	const workspace = url.searchParams.get('workspace') || 'ws-demo';
	return {
		workspace,
		simulated: workspace === SYNTH_WORKSPACE,
		synthWorkspace: SYNTH_WORKSPACE,
		kitchens,
		names,
		canRunAgent: workspace === agentWorkspace()
	};
};

/** The routine agent works in the key-less demo workspace (auth contextFor). */
const agentWorkspace = () => env.MANDATE_WORKSPACE || 'ws-demo';

/**
 * The button on /ops needs no key, so it is capped harder than POST /api/agent/run:
 * one run at a time (startAgentRun) and at most one start per COOLDOWN_MS.
 */
const COOLDOWN_MS = 20_000;
let lastStart = 0;

export const actions: Actions = {
	runAgent: async () => {
		const wait = lastStart + COOLDOWN_MS - Date.now();
		if (wait > 0) return fail(429, { message: `Try again in ${Math.ceil(wait / 1000)} s.` });
		const started = startAgentRun({ env });
		if (!started.ok) return fail(409, { message: 'An agent run is already in progress.' });
		lastStart = Date.now();
		started.done.catch((e) => console.error('[ops] agent run failed', e));
		return { started: started.id };
	}
};
