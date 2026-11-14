/**
 * The rescue the chef changes is the rescue that gets bought. Preview never presents a
 * rejected saved choice as the answer; applying replaces the old substitute and voids the approval; portion edits
 * resize product substitutes and make-in-house ingredients; more demand is never served by the old quantity.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { SCOPES_BY_ACTOR, type Plan } from '$lib/core/contracts';
import type { CallContext, ToolHandlers } from '$lib/core/ports';
import { createHandlers } from '$lib/core/services/handlers';
import { createDbPorts } from './db-ports';

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
const lineOf = (plan: Plan, productId: string) => plan.lines.find((l) => l.productId === productId);

let h: ToolHandlers;
beforeEach(async () => {
	const env = await createDbPorts();
	env.overlay.clear();
	h = createHandlers(env.ports);
});

/** Christmas plan with the ham rescued (applied) to palvikinkku 476768. */
async function rescuedHam(): Promise<Plan> {
	const { plan } = must(
		await h.plan_event(chef, { kitchenId: 'k-hotel', eventId: 'event-xmas-140' })
	);
	const ham = lineOf(plan, '462490')!;
	const r = must(
		await h.find_substitutes(chef, { planId: plan.id, version: plan.version, lineId: ham.id })
	);
	expect(r.applied).toBe(true);
	expect(lineOf(r.plan, '476768')?.qty.value).toBe(13);
	return r.plan;
}

const editHam = async (plan: Plan, grams: number) =>
	must(
		await h.edit_line(chef, {
			planId: plan.id,
			version: plan.version,
			needId: 'need:joulukinkku',
			patch: { gramsPerGuest: grams }
		})
	).plan;

describe('preview vs saved vs applied', () => {
	it('a preview under a stricter rule never returns the rejected saved choice as the recommendation', async () => {
		const plan = await rescuedHam();
		const ham = lineOf(plan, '462490')!;
		const r = must(
			await h.find_substitutes(chef, {
				planId: plan.id,
				version: plan.version,
				lineId: ham.id,
				requireOrigin: 'se'
			})
		);
		expect(r.applied).toBe(false);
		expect(r.plan.version).toBe(plan.version); // nothing changed
		expect(r.saved.map((l) => l.productId)).toEqual(['476768']);
		expect(r.candidates.find((c) => c.productId === '476768')?.rejectedReasons).toContain(
			'origin_required'
		);
		expect(r.chosen.map((l) => l.productId)).not.toContain('476768');
	});
});

describe('rescue → edit → re-rule → approve → commit buys what is shown', () => {
	it('resizes on a smaller portion, replaces on a new rule, and commits only the new product', async () => {
		let plan = await rescuedHam();
		plan = await editHam(plan, 60); // 140 × 60 g = 8.4 kg cooked
		expect(lineOf(plan, '476768')?.qty.value).toBe(6); // 8.4 / 1.5 = 5.6 → 6

		const ham = lineOf(plan, '462490')!;
		const applied = must(
			await h.find_substitutes(chef, {
				planId: plan.id,
				version: plan.version,
				lineId: ham.id,
				requireOrigin: 'de',
				apply: true
			})
		);
		expect(applied.applied).toBe(true);
		plan = applied.plan;
		expect(lineOf(plan, '476768')).toBeUndefined(); // replaced, not stacked
		const de = lineOf(plan, '463159')!;
		expect(de.qty).toMatchObject({ value: 9, unit: 'KG' }); // 8.4 kg → 5 × 1.8 kg lots
		expect(de.reasons).toContain('substitute_breaks_preference');

		const view = must(await h.get_plan(chef, { planId: plan.id }));
		expect(view.approval).toMatchObject({ state: 'pending', planVersion: plan.version });
		expect(view.approval!.lineIds).toContain(de.id);
		must(
			await h.approve(chef, {
				approvalId: view.approval!.id,
				planVersion: view.approval!.planVersion,
				termsHash: view.approval!.termsHash,
				decision: 'grant'
			})
		);
		const c = must(
			await h.commit_order(chef, {
				planId: plan.id,
				version: plan.version,
				idempotencyKey: 'rescue-commit',
				lineIds: [de.id]
			})
		);
		expect(c.committedLineIds).toEqual([de.id]);
		expect(c.totalCents).toBe(Math.round(9 * de.offer!.price!.unitCents));
	});

	it('a bigger portion is never served by the old quantity: short stock blocks the commit', async () => {
		let plan = await rescuedHam();
		plan = await editHam(plan, 180); // 25.2 kg cooked → 17 × 1.5 kg, only 15 in stock
		const sub = lineOf(plan, '476768')!;
		expect(sub.qty.value).toBe(17);
		expect(sub.reasons).toContain('INSUFFICIENT_STOCK');
		const view = must(await h.get_plan(chef, { planId: plan.id }));
		expect(view.approval?.lineIds ?? []).not.toContain(sub.id); // a gap is not put to a human
		const c = await h.commit_order(chef, {
			planId: plan.id,
			version: plan.version,
			idempotencyKey: 'short',
			lineIds: [sub.id]
		});
		expect(c.ok).toBe(false);
	});
});

describe('make-in-house ingredients follow the portion', () => {
	it('doubling the tarts doubles the pastry and filling', async () => {
		const { plan: p0 } = must(
			await h.plan_event(chef, { kitchenId: 'k-hotel', eventId: 'event-xmas-140' })
		);
		const torttu = lineOf(p0, '473317')!;
		const r = must(
			await h.find_substitutes(chef, { planId: p0.id, version: p0.version, lineId: torttu.id })
		);
		expect(r.kind).toBe('make_in_house');
		expect(lineOf(r.plan, '460373')?.qty.value).toBe(13); // 8.4 kg × 0.75 / 0.5 = 12.6 → 13
		expect(lineOf(r.plan, '461378')?.qty.value).toBe(3);
		const edited = must(
			await h.edit_line(chef, {
				planId: r.plan.id,
				version: r.plan.version,
				needId: torttu.needId!,
				patch: { gramsPerGuest: 120 }
			})
		).plan;
		expect(lineOf(edited, '460373')?.qty.value).toBe(26); // 16.8 × 0.75 / 0.5 = 25.2 → 26
		expect(lineOf(edited, '461378')?.qty.value).toBe(5); // 16.8 × 0.25 = 4.2 → 5
	});
});

describe('nothing qualifies', () => {
	it('an apply with no qualifying substitute writes nothing, however often it is repeated', async () => {
		const env = await createDbPorts();
		env.overlay.clear();
		const hh = createHandlers(env.ports);
		const { plan } = must(
			await hh.plan_event(chef, { kitchenId: 'k-hotel', eventId: 'event-xmas-140' })
		);
		const ham = lineOf(plan, '462490')!;
		const before = (await env.ports.store.load('ws-demo', 'run-1')).seq;
		for (let i = 0; i < 3; i++) {
			const r = must(
				await hh.find_substitutes(chef, {
					planId: plan.id,
					version: plan.version,
					lineId: ham.id,
					requireOrigin: 'zz', // no product qualifies
					apply: true
				})
			);
			expect(r.kind).toBe('none');
			expect(r.applied).toBe(false);
			expect(r.plan.version).toBe(plan.version);
		}
		expect((await env.ports.store.load('ws-demo', 'run-1')).seq).toBe(before);
	});

	it('applying under a rule nothing meets keeps the saved rescue and its approval (NEW-apply-wipe)', async () => {
		const plan = await rescuedHam();
		const ham = lineOf(plan, '462490')!;
		const r = must(
			await h.find_substitutes(chef, {
				planId: plan.id,
				version: plan.version,
				lineId: ham.id,
				requireOrigin: 'se',
				apply: true
			})
		);
		expect(r.applied).toBe(false);
		expect(r.plan.version).toBe(plan.version);
		expect(lineOf(r.plan, '476768')?.qty.value).toBe(13);
	});
});
