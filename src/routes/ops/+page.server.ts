import kitchenSeed from '../../../fixtures/seeds/kitchens.json';
import buffetSeed from '../../../fixtures/seeds/christmas-buffet-140.json';
import { SYNTH_PRODUCTS, SYNTH_WORKSPACE } from '$lib/server/bus/synthetic';
import { fail } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { dev } from '$app/environment';
import { cancelAgentRun, startAgentRun } from '$lib/server/agent/runs';
import {
	isPresenter,
	presenterOpen,
	presenterToken,
	PRESENTER_COOKIE,
	PRESENTER_TTL_MS
} from '$lib/server/demo/presenter';
import { ensureRunLoaded, resetDemo } from '$lib/server/demo/reset';
import { DEMO_WORKSPACE, JUDGES_WORKSPACE } from '$lib/server/demo/workspaces';
import { currentRun, currentRunStartedAt } from '$lib/server/demo/run';
import { isSandbox, resetSandbox } from '$lib/server/demo/sandbox';
import { roomLabel, visitorWorkspace, ROOM_COOKIE } from '$lib/server/demo/visitor';
import { judgeKeysOn } from '$lib/server/demo/judge-key';
import { STRESS_WORKSPACE } from '$lib/server/bus/stress';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

export type OpsKitchen = {
	id: string;
	name: string;
	kind: string;
	city: string;
	mandateWords: string;
	weeklyCapCents: number;
};

/** productId → name from the seeds and the simulated run's products; anything else shows as `Product <id>`. */
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

/**
 * Which workspace /ops shows. By default the browser's room (server/demo/visitor.ts), so a visitor sees the
 * plans they made in the kitchen or on /request. `?ws=` moves the room like on every page; the simulated run,
 * the dev load test and (for non-presenters) the stage are view-only and don't move it.
 */
async function opsWorkspace(event: RequestEvent) {
	const asked = event.url.searchParams.get('ws');
	const presenter = isPresenter(event.cookies, env, dev);
	const viewOnly =
		asked === SYNTH_WORKSPACE ||
		(dev && asked === STRESS_WORKSPACE) ||
		(asked === DEMO_WORKSPACE && !presenter);
	const v = await visitorWorkspace(event, env, dev, { follow: !viewOnly });
	if (!viewOnly) return { v, workspace: v.workspaceId, viewOnly: false };
	if (asked !== SYNTH_WORKSPACE) await ensureRunLoaded(asked!);
	return { v, workspace: asked!, viewOnly: true };
}

export const load: PageServerLoad = async (event) => {
	const { v, workspace, viewOnly } = await opsWorkspace(event);
	const presenter = v.presenter;
	return {
		workspace,
		run: workspace === SYNTH_WORKSPACE ? null : currentRun(workspace),
		simulated: workspace === SYNTH_WORKSPACE,
		synthWorkspace: SYNTH_WORKSPACE,
		/** Named rooms for the nav and labels (the page can't import server modules). */
		rooms: { stage: DEMO_WORKSPACE, shared: JUDGES_WORKSPACE },
		room: {
			kind: viewOnly ? null : v.kind,
			label: viewOnly
				? workspace === DEMO_WORKSPACE
					? 'Stage run (view only)'
					: 'Simulated run'
				: roomLabel(v),
			own: v.own
		},
		presenter,
		/** Signed in with a key (as opposed to presenter actions open for everyone in dev). */
		presenterSession: presenter && !presenterOpen(env, dev),
		/** The sign-in form is for the stage operator only: shown with `?presenter=1`, hidden from visitors. */
		showPresenterSignIn: event.url.searchParams.get('presenter') === '1',
		judgeKeys: judgeKeysOn(env) && v.kind === 'own' && !viewOnly,
		kitchens,
		names,
		/** Dev load test only: how many synthetic runs ws-stress streams. */
		copies: dev ? Number(event.url.searchParams.get('copies')) || 0 : 0,
		/** Wall-clock ms the current run started; the page ticks the scenario clock from it. */
		runStartedAt: currentRunStartedAt(workspace),
		canRunAgent: workspace === agentWorkspace() && presenter,
		canReset: !viewOnly && (isSandbox(workspace) || (workspace === DEMO_WORKSPACE && presenter))
	};
};

/** The routine agent works in the stage workspace (auth contextFor). */
const agentWorkspace = () => env.MANDATE_WORKSPACE || DEMO_WORKSPACE;

/**
 * The buttons on /ops need no key per click (a presenter signed in once, or dev), so they are capped harder
 * than POST /api/agent/run: one run at a time (startAgentRun) and at most one start per COOLDOWN_MS.
 */
const COOLDOWN_MS = 20_000;
let lastReset = 0;
let lastStart = 0;

const formField = async (request: Request, name: string) => {
	try {
		return String((await request.formData()).get(name) ?? '');
	} catch {
		return '';
	}
};

export const actions: Actions = {
	signIn: async ({ request, cookies }) => {
		const token = presenterToken(await formField(request, 'key'), env);
		if (!token) return fail(403, { message: 'That is not the chef or approver key.' });
		cookies.set(PRESENTER_COOKIE, token, {
			path: '/',
			httpOnly: true,
			sameSite: 'strict',
			maxAge: PRESENTER_TTL_MS / 1000
		});
		cookies.set(ROOM_COOKIE, DEMO_WORKSPACE, { path: '/', httpOnly: true, sameSite: 'lax' });
		return { signedIn: true };
	},
	signOut: async ({ cookies }) => {
		cookies.delete(PRESENTER_COOKIE, { path: '/' });
		cookies.delete(ROOM_COOKIE, { path: '/' });
		return { signedOut: true };
	},
	runAgent: async ({ cookies }) => {
		if (!isPresenter(cookies, env, dev))
			return fail(403, { message: 'Sign in as the presenter to run the agent from here.' });
		const wait = lastStart + COOLDOWN_MS - Date.now();
		if (wait > 0) return fail(429, { message: `Try again in ${Math.ceil(wait / 1000)} s.` });
		const started = startAgentRun({ env });
		if (!started.ok) return fail(409, { message: 'An agent run is already in progress.' });
		lastStart = Date.now();
		started.done.catch((e) => console.error('[ops] agent run failed', e));
		return { started: started.id };
	},
	cancelAgent: async ({ request, cookies }) => {
		if (!isPresenter(cookies, env, dev))
			return fail(403, { message: 'Sign in as the presenter to stop the agent from here.' });
		const id = await formField(request, 'id');
		if (!id) return fail(400, { message: 'Which run? The form sent no run id.' });
		const r = cancelAgentRun(id, { kind: 'chef', id: 'ops-presenter' });
		if (!r.ok) return fail(404, { message: 'That run is no longer in progress.' });
		await r.done;
		return { cancelled: id };
	},
	resetRun: async (event) => {
		const { v, workspace, viewOnly } = await opsWorkspace(event);
		if (viewOnly) return fail(403, { message: 'This view is read-only.' });
		if (isSandbox(workspace)) {
			const r = await resetSandbox(workspace);
			if (r.ok) return { reset: r.runId, startedAt: currentRunStartedAt(workspace) };
			if ('retryInMs' in r)
				return fail(429, {
					message: `Just reset; try again in ${Math.ceil(r.retryInMs / 1000)} s.`
				});
			return fail(403, { message: 'This workspace cannot be reset from here.' });
		}
		if (workspace !== DEMO_WORKSPACE || !v.presenter)
			return fail(403, { message: 'Only the presenter starts the stage over.' });
		if (Date.now() - lastReset < COOLDOWN_MS)
			return fail(429, { message: 'Just reset; wait a moment.' });
		lastReset = Date.now();
		const { runId } = await resetDemo();
		return { reset: runId, startedAt: currentRunStartedAt(DEMO_WORKSPACE) };
	}
};
