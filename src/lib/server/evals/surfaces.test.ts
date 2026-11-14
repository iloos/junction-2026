/**
 * One plan, three surfaces (F12): REST get_plan's FulfilmentView is the one definition of coverage; the kitchen dish
 * status (buildLiveView) and the Ops coverage count (routes/ops/cases.ts) must say the same about every need, in every
 * plan state a demo walks through. Real handlers on PGlite, no network. Known disagreements are listed in EXPECT_FAIL
 * (finding id → result keys), as in the scenario evals.
 *
 * Mapping from FulfilmentView (the reference) to what each surface may show:
 *   kitchen: uncovered → shortfall · partial → partial · unresolved 0 with plannedUnknown > 0 → unknown ·
 *            otherwise ok or rescued.
 *   ops:     a need counts as covered exactly when its FulfilmentView has unresolved 0 and plannedUnknown 0
 *            (D10: unknown supply is never cover).
 */
import { describe, expect, it } from 'vitest';
import { SCOPES_BY_ACTOR, type FulfilmentView, type Plan } from '$lib/core/contracts';
import type { CallContext, ToolHandlers } from '$lib/core/ports';
import { createHandlers } from '$lib/core/services/handlers';
import { rulesFor } from '$lib/kitchen/fixture-plan';
import { buildLiveView } from '$lib/kitchen/live-view';
import { coverage } from '../../../routes/ops/cases';
import { applyExpectFail } from '../../../../evals/check';
import type { CheckResult } from '../../../../evals/types';
import { createDbPorts, loadSeedKitchens } from '../store/db-ports';

const EXPECT_FAIL: Record<string, string[]> = {};

const ctx = (kind: keyof typeof SCOPES_BY_ACTOR, env: { workspaceId: string; runId: string }) =>
	({
		workspaceId: env.workspaceId,
		runId: env.runId,
		actor: { kind, id: `${kind}-1` },
		scopes: SCOPES_BY_ACTOR[kind],
		via: 'eval'
	}) as CallContext;
const must = <T>(
	r: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }
) => {
	if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
	return r.value;
};

/** The demo's states of the Christmas plan, each a fresh view through get_plan. */
async function states(): Promise<{ name: string; plan: Plan; facts: Record<string, unknown> }[]> {
	const env = await createDbPorts();
	env.overlay.clear();
	const h: ToolHandlers = createHandlers(env.ports);
	const chef = ctx('chef', env);
	const read = async (id: string) => must(await h.get_plan(chef, { planId: id })).plan;
	const out: { name: string; plan: Plan; facts: Record<string, unknown> }[] = [];
	// The product facts the kitchen snapshot passes to buildLiveView (server/kitchen/live.ts).
	const factsFor = async (p: Plan) => {
		const ids = [...new Set(p.lines.map((l) => l.productId))];
		const [products, { offers }] = await Promise.all([
			env.ports.catalog.get(ids),
			env.ports.catalog.offers(ids, p.deliverBy)
		]);
		const facts: Record<string, unknown> = {};
		for (const id of ids) {
			const x = products.get(id);
			if (x)
				facts[id] = {
					name: x.nameFi,
					origin: x.origin,
					reliability: x.reliability,
					co2PerKg: x.co2PerKg?.value,
					salesUnit: x.salesUnit,
					offer: offers.find((o) => o.productId === id)
				};
		}
		return facts;
	};
	const push = async (name: string, id: string) => {
		const p = await read(id);
		out.push({ name, plan: p, facts: await factsFor(p) });
	};

	let plan = must(
		await h.plan_event(chef, { kitchenId: 'k-hotel', eventId: 'event-xmas-140' })
	).plan;
	await push('planned', plan.id);

	for (const l of plan.lines.filter((x) => x.state === 'unorderable' && !x.substituteFor)) {
		const cur = await read(plan.id);
		const r = await h.find_substitutes(chef, {
			planId: cur.id,
			version: cur.version,
			lineId: l.id
		});
		if (r.ok) plan = r.value.plan;
	}
	await push('rescued', plan.id);

	const view = must(await h.get_plan(chef, { planId: plan.id }));
	if (view.approval)
		must(
			await h.approve(ctx('approver', env), {
				approvalId: view.approval.id,
				planVersion: view.approval.planVersion,
				termsHash: view.approval.termsHash,
				decision: 'grant'
			})
		);
	const cur = await read(plan.id);
	must(
		await h.commit_order(chef, {
			planId: cur.id,
			version: cur.version,
			idempotencyKey: 'surfaces-1'
		})
	);
	await push('committed', plan.id);
	return out;
}

function kitchenStatuses(plan: Plan, facts: Record<string, unknown>): Map<string, string> {
	const kitchen = loadSeedKitchens().find((k) => k.id === 'k-hotel')!;
	const v = buildLiveView({
		plan,
		rescues: {},
		facts: facts as never,
		seed: { title: 'eval', date: '2026-12-12', guests: 140, serviceStyle: 'buffet' },
		rules: rulesFor(kitchen, 'kitchen'),
		weekSpentCents: 0,
		previewRanking: false
	});
	return new Map(v.dishes.map((d) => [d.needId, d.status]));
}

const allowedKitchen = (f: FulfilmentView): string[] =>
	f.status === 'uncovered'
		? ['shortfall']
		: f.status === 'partial'
			? ['partial']
			: f.plannedUnknown.value > 1e-9
				? // A rescue from ingredients Valio states no stock for (D8 amendment) reads "rescued" with the rescue card
					// saying so ("Valio doesn't state stock for 4 of 5 ingredients").
					['unknown', 'rescued']
				: ['ok', 'rescued'];

describe('one plan, three surfaces (F12)', () => {
	it('get_plan, the kitchen and Ops agree on every need', { timeout: 120_000 }, async () => {
		const results: CheckResult[] = [];
		for (const { name, plan, facts } of await states()) {
			const fv = plan.view?.fulfilment ?? [];
			results.push({
				key: `rest.${name}`,
				pass: fv.length === plan.needs.length,
				detail: `${fv.length} views for ${plan.needs.length} needs`
			});
			const kitchen = kitchenStatuses(plan, facts);
			for (const f of fv) {
				const k = kitchen.get(f.needId);
				const allowed = allowedKitchen(f);
				results.push({
					key: `kitchen.${name}[${f.label}]`,
					pass: k !== undefined && allowed.includes(k),
					detail: `kitchen ${k} vs fulfilment ${f.status} (unresolved ${f.unresolved.value}, unknown ${f.plannedUnknown.value}); allowed ${allowed}`
				});
			}
			const want = fv.filter(
				(f) => f.unresolved.value <= 1e-9 && f.plannedUnknown.value <= 1e-9
			).length;
			const ops = coverage([plan]);
			results.push({
				key: `ops.${name}`,
				pass: ops?.covered === want && ops?.total === fv.length,
				detail: `ops ${ops?.covered}/${ops?.total} vs fulfilment ${want}/${fv.length}`
			});
		}
		const final = applyExpectFail(results, EXPECT_FAIL);
		const failed = final.filter((r) => !r.pass);
		console.log(
			`${failed.length ? '✗' : '✓'} surfaces ${final.length - failed.length}/${final.length}` +
				failed.map((r) => `\n    ✗ ${r.key}: ${r.detail}`).join('') +
				final
					.filter((r) => r.detail.startsWith('expected-fail'))
					.map((r) => `\n    ~ ${r.key}: ${r.detail}`)
					.join('')
		);
		expect(failed).toEqual([]);
	});
});
