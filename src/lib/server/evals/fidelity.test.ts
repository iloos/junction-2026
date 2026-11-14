/**
 * Cross-entry intent fidelity (evals/fidelity/cases.json): the same words through /request, the agent and a REST
 * place_order must give the same basket. Each path runs on its own fresh PGlite workspace with the real handlers and
 * the fixture parser/planner (no network). Checked as properties of the resulting plan (delivery date, physical
 * amount, constraint, product category), so a retrieval change can't rewrite the expectations. Known gaps are listed
 * per case in `expectFail` (finding id → result keys), as in the scenario evals.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Plan, Product as CatalogProduct } from '$lib/core/contracts';
import { scenarioDate } from '$lib/core/scenario';
import { applyExpectFail } from '../../../../evals/check';
import type { CheckResult } from '../../../../evals/types';
import { runGoal } from '../agent';
import { scriptedPlanner } from '../agent/loop';
import { trialWorkspace } from '../agent/trial-harness';
import { contentPerSalesUnit } from '../request/convert';
import { runRequest } from '../request/run';

interface Case {
	id: string;
	kitchen: string;
	text: string;
	/** The same request phrased as an agent goal (an order verb and the kitchen). */
	agentText?: string;
	rest: { deliverBy: string; lines: Record<string, unknown>[] };
	expect: {
		deliverBy: string;
		physical: { unit: 'kg' | 'l'; min: number; max: number };
		freeFrom?: string;
		sameCategoryAs?: string;
	};
	expectFail?: Record<string, string[]>;
}
interface Product {
	productId: string;
	category: string;
	salesUnit: string;
	packs: { unit: string; baseUnits: number }[];
	freeFrom?: string[];
}

const root = process.cwd();
const cases = (
	JSON.parse(readFileSync(join(root, 'evals', 'fidelity', 'cases.json'), 'utf-8')) as {
		cases: Case[];
	}
).cases;
const products = new Map(
	(
		JSON.parse(
			readFileSync(join(root, 'data', 'valio', 'normalized', 'products.json'), 'utf-8')
		) as Product[]
	).map((p) => [p.productId, p])
);

/**
 * Physical amount of a line, using the request module's own conversion (name and net weight, cross-checked), so the
 * check reads content the way the app does. Null when the content is unknown.
 */
function physical(productId: string, qty: number, unit: string, want: 'kg' | 'l'): number | null {
	const p = products.get(productId);
	if (!p) return null;
	const c = contentPerSalesUnit(p as unknown as CatalogProduct, want);
	if ('error' in c) return null;
	const base = (u: string) => p.packs.find((x) => x.unit === u)?.baseUnits;
	const factor = unit === p.salesUnit ? 1 : (base(unit) ?? NaN) / (base(p.salesUnit) ?? NaN);
	const v = qty * factor * c.value;
	return Number.isFinite(v) ? v : null;
}

type Path = 'rest' | 'request' | 'agent';

async function playPath(c: Case, path: Path): Promise<{ plans: Plan[]; error?: string }> {
	const w = await trialWorkspace();
	const today = scenarioDate(w.env.ports.clock.now());
	try {
		if (path === 'rest') {
			const r = await w.handlers.place_order(w.ctx('kitchen_agent'), {
				kitchenId: c.kitchen,
				deliverBy: c.rest.deliverBy,
				idempotencyKey: `fidelity-${c.id}`,
				lines: c.rest.lines as never
			});
			if (!r.ok) return { plans: [], error: r.error.code };
		} else if (path === 'request') {
			const kitchen = (await w.env.ports.store.kitchens(w.env.workspaceId)).find(
				(k) => k.id === c.kitchen
			)!;
			await runRequest(c.text, {
				handlers: w.handlers,
				ctx: w.ctx('kitchen_agent'),
				today,
				kitchen,
				llm: null,
				llmKind: 'fixture',
				place: true
			});
		} else {
			const run = await runGoal({
				goal: c.agentText ?? c.text,
				principal: w.principal({ kitchenIds: [c.kitchen], id: `fidelity-${c.id}` }),
				handlers: w.handlers,
				planner: scriptedPlanner(),
				source: { ...w.source, today: () => today }
			});
			const plans = Object.values((await w.state()).plans);
			return plans.length
				? { plans }
				: {
						plans,
						error: `agent stopped ${run.stopped}: ${run.summary.slice(0, 160)}`
					};
		}
	} catch (e) {
		return { plans: [], error: (e as Error).message.slice(0, 120) };
	}
	return { plans: Object.values((await w.state()).plans) };
}

function checkPath(c: Case, path: Path, r: { plans: Plan[]; error?: string }): CheckResult[] {
	const k = (s: string) => `${path}.${s}`;
	const plan = r.plans[r.plans.length - 1];
	if (!plan) return [{ key: k('plan'), pass: false, detail: r.error ?? 'no plan created' }];
	const lines = plan.lines.filter((l) => l.state !== 'unorderable' && l.state !== 'rejected');
	const out: CheckResult[] = [{ key: k('plan'), pass: true, detail: plan.id }];
	out.push({
		key: k('deliverBy'),
		pass: plan.deliverBy === c.expect.deliverBy,
		detail: `${plan.deliverBy} vs ${c.expect.deliverBy}`
	});
	const { unit, min, max } = c.expect.physical;
	const amounts = lines.map((l) => physical(l.productId, l.qty.value, l.qty.unit, unit));
	const total = amounts.reduce<number>((s, a) => s + (a ?? NaN), 0);
	out.push({
		key: k('physical'),
		pass: lines.length > 0 && total >= min - 1e-6 && total <= max + 1e-6,
		detail: `${lines.map((l) => `${l.qty.value} ${l.qty.unit} ${l.productId}`).join(' + ') || 'no lines'} ≈ ${total.toFixed(2)} ${unit} (want ${min}–${max})`
	});
	if (c.expect.freeFrom) {
		const bad = lines.filter(
			(l) => !products.get(l.productId)?.freeFrom?.includes(c.expect.freeFrom!)
		);
		out.push({
			key: k('freeFrom'),
			pass: lines.length > 0 && bad.length === 0,
			detail: bad.length ? `not ${c.expect.freeFrom}-free: ${bad.map((l) => l.productId)}` : 'ok'
		});
	}
	if (c.expect.sameCategoryAs) {
		const cat = products.get(c.expect.sameCategoryAs)?.category;
		const bad = lines.filter((l) => products.get(l.productId)?.category !== cat);
		out.push({
			key: k('category'),
			pass: lines.length > 0 && bad.length === 0,
			detail: bad.length ? `outside category ${cat}: ${bad.map((l) => l.productId)}` : 'ok'
		});
	}
	return out;
}

describe('cross-entry intent fidelity', () => {
	for (const c of cases)
		it(c.id, { timeout: 120_000 }, async () => {
			const results: CheckResult[] = [];
			for (const path of ['rest', 'request', 'agent'] as const)
				results.push(...checkPath(c, path, await playPath(c, path)));
			const final = applyExpectFail(results, c.expectFail);
			const failed = final.filter((r) => !r.pass);
			const known = final.filter((r) => r.detail.startsWith('expected-fail'));
			console.log(
				`${failed.length ? '✗' : '✓'} ${c.id} ${final.length - failed.length}/${final.length}` +
					failed.map((r) => `\n    ✗ ${r.key}: ${r.detail}`).join('') +
					known.map((r) => `\n    ~ ${r.key}: ${r.detail}`).join('')
			);
			expect(failed).toEqual([]);
		});
});
