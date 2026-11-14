/**
 * Grounded menu (evals/menu/grounding-check.ts): each golden brief (evals/briefs/golden.json) is answered through
 * /request, its menu proposed, then grounded by `groundMenu(deps, view)` from src/lib/server/menu/grounding.ts (Exa
 * cited recipes via make-in-house; replay in fixture mode). Every dish is sourced with cited recipes and each
 * ingredient classified, or says why it has no source; grounding never changes the menu. Skipped until
 * menu/grounding.ts exists (owner D), so it gates the moment it lands.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scenarioDate } from '$lib/core/scenario';
import type { BriefAnswer, BriefField } from '$lib/ui/request/types';
import { checkGrounding, type MenuGrounding } from '../../../../evals/menu/grounding-check';
import { trialWorkspace } from '../agent/trial-harness';
import { runRequest } from '../request/run';
import { toEventBrief } from '../menu/brief';
import { proposeForBrief, type MenuView } from '../menu/flow';

const grounding = import.meta.glob<{
	groundMenu: (
		d: { workspaceId: string; catalog: unknown; now: () => Date },
		view: MenuView
	) => Promise<MenuGrounding>;
}>('../menu/grounding.ts');
const load = Object.values(grounding)[0];

interface Brief {
	id: string;
	kitchen: string;
	text: string;
	answers: Partial<Record<BriefField, BriefAnswer['value']>>;
}
const briefs = (
	JSON.parse(readFileSync(join(process.cwd(), 'evals', 'briefs', 'golden.json'), 'utf-8')) as {
		briefs: Brief[];
	}
).briefs;

describe.skipIf(!load)('suite: grounded menu', () => {
	for (const b of briefs)
		it(b.id, { timeout: 120_000 }, async () => {
			const { groundMenu } = await load!();
			const w = await trialWorkspace();
			const today = scenarioDate(w.env.ports.clock.now());
			const kitchen = (await w.env.ports.store.kitchens(w.env.workspaceId)).find(
				(k) => k.id === b.kitchen
			)!;
			const given: BriefAnswer[] = [];
			const ask = () =>
				runRequest(b.text, {
					handlers: w.handlers,
					ctx: w.ctx('chef'),
					today,
					kitchen,
					llm: null,
					llmKind: 'fixture',
					place: true,
					briefAnswers: given
				});
			let r = await ask();
			for (let round = 0; r.event?.question && round < 8; round++) {
				const value = b.answers[r.event.question.field];
				if (value === undefined) break;
				given.push({ id: r.event.question.id, value });
				r = await ask();
			}
			const d = r.event?.draft;
			expect(d && !r.event?.question, 'brief complete').toBeTruthy();
			const md = {
				workspaceId: w.env.workspaceId,
				store: w.env.ports.menus!,
				catalog: w.env.ports.catalog,
				now: () => w.env.ports.clock.now()
			};
			const view = await proposeForBrief(md, {
				kitchenId: b.kitchen,
				brief: toEventBrief(d!, b.text)!
			});
			const before = JSON.stringify(view.proposal);
			const g = await groundMenu(md, view);
			const after = JSON.stringify(
				await md.store.get(md.workspaceId, view.proposal.id, view.proposal.revision)
			);
			const results = checkGrounding(b.id, view.proposal, g, { before, after });
			const sourced = Object.values(g.dishes).filter((x) => x.status === 'sourced').length;
			console.log(`${b.id}: ${sourced}/${view.proposal.dishes.length} dishes sourced`);
			expect(results.filter((x) => !x.pass)).toEqual([]);
		});
});
