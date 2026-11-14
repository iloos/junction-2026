/**
 * The /request page's menu actions in the visitor's workspace: propose from the brief the words and answers make,
 * edit amounts, accept (the chef's review, recorded by the server) and plan. The brief is rebuilt on the server from
 * the request text and the brief answers; the page never sends a proposal body, a brief or a review record.
 */
import { err, ok, type Result } from '$lib/core/contracts';
import { createLlmRouter } from '$lib/server/adapters/llm/router';
import { traceEvent, type Trace } from '$lib/server/adapters/llm/trace';
import type { Env } from '$lib/server/auth';
import { publish } from '$lib/server/bus';
import { actors, llmKind, ports, simToday } from '$lib/server/request';
import { handlers } from '$lib/server/tools/handlers';
import type { BriefAnswer } from '$lib/ui/request/types';
import { applyBriefAnswers, draftBrief, toEventBrief } from './brief';
import {
	acceptMenu,
	editMenu,
	planMenu,
	proposeForBrief,
	readMenu,
	type MenuChange,
	type MenuDeps,
	type MenuPlanResult,
	type MenuView
} from './flow';
import type { ProposeStep } from './proposal';
import { memoryMenuStore } from './store';
import { groundingFor, groundMenuInBackground } from '$lib/server/web/grounding';

/** One process-wide fallback when the ports carry no MenuStore (a catalogue-only fixture). */
let fallbackStore: ReturnType<typeof memoryMenuStore> | null = null;

async function deps(workspaceId: string): Promise<MenuDeps> {
	const p = (await ports()).ports;
	return {
		workspaceId,
		store: p.menus ?? (fallbackStore ??= memoryMenuStore()),
		catalog: p.catalog,
		now: () => p.clock.now()
	};
}

export async function proposeFromRequest(o: {
	env: Env;
	workspaceId: string;
	kitchenId: string;
	text: string;
	briefAnswers: BriefAnswer[];
	nonce?: string;
	onStep?: (s: ProposeStep) => void;
}): Promise<Result<MenuView>> {
	const today = await simToday(o.workspaceId);
	const brief = toEventBrief(
		applyBriefAnswers(draftBrief(o.text, today), o.briefAnswers, today),
		o.text
	);
	if (!brief) return err('INVALID_INPUT', 'the brief is not complete: answer its questions first');
	const a = await actors(o.env, o.workspaceId);
	const trace: Trace = (step, data) =>
		void publish(o.workspaceId, [
			traceEvent(a.chef, step, { actor: a.chef.actor.id, purpose: 'menu.propose', ...data })
		]);
	const llm =
		llmKind(o.env) === 'fixture' ? null : createLlmRouter(o.env, trace).for('menu.propose');
	const d = await deps(o.workspaceId);
	const view = await proposeForBrief(
		{ ...d, llm },
		{ kitchenId: o.kitchenId, brief, nonce: o.nonce, onStep: o.onStep }
	);
	// Each dish's ingredients against cited web recipes, in the background: evidence for the chef, never applied.
	await groundMenuInBackground(
		o.env,
		o.workspaceId,
		view.proposal.dishes,
		(await ports()).ports.catalog
	).catch(() => {});
	return ok(withGrounding(view));
}

/** The menu view with what is known so far about each dish's sourced recipes, keyed by dish id. */
function withGrounding(view: MenuView): MenuView {
	const known = groundingFor(view.proposal.dishes.map((x) => x.name));
	const grounding = Object.fromEntries(
		view.proposal.dishes.flatMap((x) => (known[x.name] ? [[x.id, known[x.name]]] : []))
	);
	return Object.keys(grounding).length ? { ...view, grounding } : view;
}

export async function readMenuFor(workspaceId: string, id: string): Promise<Result<MenuView>> {
	const r = await readMenu(await deps(workspaceId), id);
	return r.ok ? ok(withGrounding(r.value)) : r;
}

export async function editMenuFor(o: {
	workspaceId: string;
	id: string;
	revision: number;
	changes: MenuChange[];
}): Promise<Result<MenuView>> {
	return editMenu(await deps(o.workspaceId), o);
}

/** The page's chef accepts the revision they saw. */
export async function acceptMenuAsChef(o: {
	env: Env;
	workspaceId: string;
	id: string;
	revision: number;
}): Promise<Result<MenuView>> {
	const a = await actors(o.env, o.workspaceId);
	return acceptMenu(await deps(o.workspaceId), { ...o, by: a.chef.actor });
}

export async function planMenuAsChef(o: {
	env: Env;
	workspaceId: string;
	id: string;
	revision: number;
}): Promise<Result<MenuPlanResult>> {
	const a = await actors(o.env, o.workspaceId);
	const tasks = (await ports()).ports.tasks;
	return planMenu({ ...(await deps(o.workspaceId)), handlers, ctx: a.chef, tasks }, o);
}

const id64 = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 64;

/** The chef's menu changes from a request body; anything malformed is dropped, never trusted. */
export function readChanges(raw: unknown): MenuChange[] {
	if (!Array.isArray(raw)) return [];
	return raw.slice(0, 200).flatMap((e): MenuChange[] => {
		const c = (e ?? {}) as Record<string, unknown>;
		switch (c.kind) {
			case 'amount':
				return id64(c.ingredientId) && typeof c.amountPerCover === 'number'
					? [{ kind: 'amount', ingredientId: c.ingredientId, amountPerCover: c.amountPerCover }]
					: [];
			case 'unresolve':
			case 'removeIngredient':
				return id64(c.ingredientId) ? [{ kind: c.kind, ingredientId: c.ingredientId }] : [];
			case 'removeDish':
				return id64(c.dishId) ? [{ kind: 'removeDish', dishId: c.dishId }] : [];
			case 'keepOpen':
				return id64(c.issueId) && typeof c.text === 'string'
					? [{ kind: 'keepOpen', issueId: c.issueId, text: c.text.slice(0, 280) }]
					: [];
			default:
				return [];
		}
	});
}
