import kitchenSeed from '../../../fixtures/seeds/kitchens.json';
import buffetSeed from '../../../fixtures/seeds/christmas-buffet-140.json';
import { SYNTH_PRODUCTS, SYNTH_WORKSPACE } from '$lib/server/bus/synthetic';
import { fail } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { dev } from '$app/environment';
import { startAgentRun } from '$lib/server/bus/agent-runs';
import { ensureRunLoaded, resetDemo } from '$lib/server/demo/reset';
import { currentRunStartedAt } from '$lib/server/demo/run';
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

export const load: PageServerLoad = async ({ url }) => {
	const workspace = url.searchParams.get('workspace') || 'ws-demo';
	if (workspace !== SYNTH_WORKSPACE) await ensureRunLoaded(workspace);
	return {
		workspace,
		simulated: workspace === SYNTH_WORKSPACE,
		synthWorkspace: SYNTH_WORKSPACE,
		kitchens,
		names,
		/** Wall-clock ms the current run started; the page ticks the scenario clock from it. */
		runStartedAt: currentRunStartedAt(workspace),
		canRunAgent: workspace === agentWorkspace() && presenterOpen(),
		canReset: workspace === agentWorkspace() && presenterOpen()
	};
};

/** The routine agent works in the key-less demo workspace (auth contextFor). */
const agentWorkspace = () => env.MANDATE_WORKSPACE || 'ws-demo';

/**
 * The button on /ops needs no key, so it is capped harder than POST /api/agent/run:
 * one run at a time (startAgentRun) and at most one start per COOLDOWN_MS.
 */
const COOLDOWN_MS = 20_000;

/**
 * The key-less presenter buttons (run the agent, reset the stage): on in dev, and on the deployed app only
 * with DEMO_RESET_OPEN=1. In production the presenter uses POST /api/agent/run and /api/demo/reset with a key.
 */
const presenterOpen = () => dev || env.DEMO_RESET_OPEN === '1';
let lastReset = 0;
let lastStart = 0;

export const actions: Actions = {
	runAgent: async () => {
		if (!presenterOpen())
			return fail(403, {
				message: 'Running the agent from here is turned off; use POST /api/agent/run.'
			});
		const wait = lastStart + COOLDOWN_MS - Date.now();
		if (wait > 0) return fail(429, { message: `Try again in ${Math.ceil(wait / 1000)} s.` });
		const started = startAgentRun({ env });
		if (!started.ok) return fail(409, { message: 'An agent run is already in progress.' });
		lastStart = Date.now();
		started.done.catch((e) => console.error('[ops] agent run failed', e));
		return { started: started.id };
	},
	resetRun: async () => {
		if (!presenterOpen())
			return fail(403, { message: 'Reset is turned off here; use POST /api/demo/reset.' });
		if (Date.now() - lastReset < COOLDOWN_MS)
			return fail(429, { message: 'Just reset; wait a moment.' });
		lastReset = Date.now();
		const { runId } = await resetDemo();
		return { reset: runId, startedAt: currentRunStartedAt('ws-demo') };
	}
};
