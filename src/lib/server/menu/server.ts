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
	editAmounts,
	planMenu,
	proposeForBrief,
	readMenu,
	type AmountEdit,
	type MenuDeps,
	type MenuPlanResult,
	type MenuView
} from './flow';
import { memoryMenuStore } from './store';

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
}): Promise<Result<MenuView>> {
	const today = await simToday();
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
	return ok(
		await proposeForBrief({ ...d, llm }, { kitchenId: o.kitchenId, brief, nonce: o.nonce })
	);
}

export async function readMenuFor(workspaceId: string, id: string): Promise<Result<MenuView>> {
	return readMenu(await deps(workspaceId), id);
}

export async function editMenu(o: {
	workspaceId: string;
	id: string;
	revision: number;
	edits: AmountEdit[];
}): Promise<Result<MenuView>> {
	return editAmounts(await deps(o.workspaceId), o);
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

/** Amount edits from a request body; anything malformed is dropped, never trusted. */
export function readEdits(raw: unknown): AmountEdit[] {
	if (!Array.isArray(raw)) return [];
	return raw.slice(0, 200).flatMap((e) => {
		const { ingredientId, amountPerCover } = (e ?? {}) as Record<string, unknown>;
		return typeof ingredientId === 'string' &&
			ingredientId.length <= 64 &&
			typeof amountPerCover === 'number'
			? [{ ingredientId, amountPerCover }]
			: [];
	});
}
