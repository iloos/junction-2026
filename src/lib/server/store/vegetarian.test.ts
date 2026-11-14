/**
 * A vegetarian dish stays vegetarian. The lunch restaurant's vegetable balls are undeliverable, so the agent looks for
 * a substitute; on prod it picked Lagerblad meatballs (no reason held it). The need now carries the requirement
 * `labels: ['vegetarian']`, met by the catalogue's diet tags (vegan counts), so no meat product can serve it: not as
 * a ranked substitute, not by a chef's product swap, not in a commit.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { SCOPES_BY_ACTOR, type Plan } from '$lib/core/contracts';
import type { CallContext, ToolHandlers } from '$lib/core/ports';
import { createHandlers } from '$lib/core/services/handlers';
import { createDbPorts } from './db-ports';
import { loadCatalogue } from '../adapters/catalog/valio';

const chef: CallContext = {
	workspaceId: 'ws-demo',
	runId: 'run-1',
	actor: { kind: 'chef', id: 'chef-1' },
	scopes: SCOPES_BY_ACTOR.chef,
	via: 'test'
};
const must = <T>(
	r: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }
): T => {
	if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
	return r.value;
};

const NEED = 'need:kasvispyorykat';
/** Lagerblad Lihapyörykkä 16 g / 5.2 kg: the meatballs prod picked for the vegetable dish. */
const MEATBALLS = '461848';
const catalogue = loadCatalogue('data/valio');
const vegetarian = (id: string) => {
	const diet = catalogue.get(id)?.diet ?? [];
	return diet.includes('vegetarian') || diet.includes('vegan');
};

let h: ToolHandlers;
beforeEach(async () => {
	const env = await createDbPorts();
	env.overlay.clear();
	h = createHandlers(env.ports);
});

const lunch = async (): Promise<Plan> =>
	must(await h.plan_event(chef, { kitchenId: 'k-lounas', eventId: 'event-lounas-wed-320' })).plan;

describe('the lunch restaurant never buys meat for its vegetable balls', () => {
	it('plans the vegetable balls as a vegetarian need', async () => {
		const plan = await lunch();
		expect(plan.needs.find((n) => n.id === NEED)?.requirements).toEqual({ labels: ['vegetarian'] });
		expect(vegetarian(MEATBALLS)).toBe(false);
	});

	it('ranks only vegetarian substitutes for it, and applies only a vegetarian one', async () => {
		const plan = await lunch();
		const line = plan.lines.find((l) => l.needId === NEED && !l.substituteFor)!;
		const r = must(
			await h.find_substitutes(chef, { planId: plan.id, version: plan.version, lineId: line.id })
		);
		// Candidates the agent offers (no rejection; a CAUTION is evidence, not a rejection) are vegetarian; a product
		// without the diet tag is listed only as rejected, with its reason.
		const offered = r.candidates.filter(
			(c) => c.rejectedReasons.filter((x) => !x.startsWith('CAUTION')).length === 0
		);
		for (const c of offered) expect(vegetarian(c.productId), c.productId).toBe(true);
		for (const c of r.candidates.filter((x) => !vegetarian(x.productId)))
			expect(c.rejectedReasons.join(' '), c.productId).toMatch(/requirement|vegetarian/);
		for (const l of r.plan.lines.filter((x) => x.needId === NEED && x.state !== 'rejected'))
			expect(vegetarian(l.productId), l.productId).toBe(true);
	});

	it('refuses a chef swapping the line to meatballs, and no commit carries them', async () => {
		const plan = await lunch();
		const line = plan.lines.find((l) => l.needId === NEED && !l.substituteFor)!;
		const r = await h.edit_line(chef, {
			planId: plan.id,
			version: plan.version,
			lineId: line.id,
			patch: { productId: MEATBALLS }
		});
		// Either the edit is refused outright, or the swapped line is held as forbidden: never orderable.
		if (r.ok) {
			const swapped = r.value.plan.lines.find(
				(l) => l.productId === MEATBALLS && l.needId === NEED
			);
			if (swapped) {
				expect(swapped.reasons).toContain('requirement_unmet');
				expect(['eligible', 'committed']).not.toContain(swapped.state);
			}
			const after = r.value.plan;
			const c = await h.commit_order(chef, {
				planId: after.id,
				version: after.version,
				idempotencyKey: 'veg-guard'
			});
			if (c.ok) {
				const p = must(await h.get_plan(chef, { planId: after.id })).plan;
				const meat = p.lines.filter(
					(l) => l.needId === NEED && l.state === 'committed' && !vegetarian(l.productId)
				);
				expect(meat).toEqual([]);
			}
		} else expect(r.error.code).not.toBe('INTERNAL');
	});
});
