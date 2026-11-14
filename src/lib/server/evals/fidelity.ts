/**
 * Shared by the fidelity suite and the live-planner diagnostics: the cases in evals/fidelity/cases.json and the
 * property checks of a resulting plan (date, physical amount, constraint, category), independent of search order.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plan, Product as CatalogProduct } from '$lib/core/contracts';
import type { CheckResult } from '../../../../evals/types';
import { scenarioDate } from '$lib/core/scenario';
import { runGoal } from '../agent';
import { scriptedPlanner } from '../agent/loop';
import { trialWorkspace } from '../agent/trial-harness';
import { contentPerSalesUnit } from '../request/convert';
import { runRequest } from '../request/run';
import type { EventView } from '$lib/ui/request/types';

export interface Case {
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
export interface Product {
	productId: string;
	category: string;
	salesUnit: string;
	packs: { unit: string; baseUnits: number }[];
	freeFrom?: string[];
}

const root = process.cwd();
export const cases = (
	JSON.parse(readFileSync(join(root, 'evals', 'fidelity', 'cases.json'), 'utf-8')) as {
		cases: Case[];
	}
).cases;
export const products = new Map(
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
export function physical(
	productId: string,
	qty: number,
	unit: string,
	want: 'kg' | 'l'
): number | null {
	const p = products.get(productId);
	if (!p) return null;
	const c = contentPerSalesUnit(p as unknown as CatalogProduct, want);
	if ('error' in c) return null;
	const base = (u: string) => p.packs.find((x) => x.unit === u)?.baseUnits;
	const factor = unit === p.salesUnit ? 1 : (base(unit) ?? NaN) / (base(p.salesUnit) ?? NaN);
	const v = qty * factor * c.value;
	return Number.isFinite(v) ? v : null;
}

export function checkBasket(
	c: Case,
	path: string,
	r: { plans: Plan[]; error?: string }
): CheckResult[] {
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

/**
 * Monday morning, before Valio's 17:00 cut-off: "tomorrow" is still orderable, so the entries are compared on intent,
 * not on a closed cut-off.
 */
export const FIDELITY_NOW = new Date('2026-12-07T09:00:00+02:00');

export interface Played {
	plans: Plan[];
	error?: string;
	/** /request: set when the words were read as an event brief. */
	event?: EventView;
	/** Receipts written (no read or event intent may write one). */
	receipts: number;
	/** Delivery dates of the committed order lines' plans, one per receipt. */
	committedFor: string[];
	/** What the entry told the chef: /request message, notes and delivery note, or the agent's summary. */
	said: string;
}

/**
 * The chef's words through one entry on a fresh PGlite workspace with the fixture parser or the scripted planner:
 * `/request` (runRequest, placing) or the agent (runGoal, the principal holds only this kitchen).
 */
export async function playText(
	kitchen: string,
	text: string,
	path: 'request' | 'agent',
	id: string,
	now: Date = FIDELITY_NOW
): Promise<Played> {
	const w = await trialWorkspace();
	w.env.ports.clock = { now: () => now };
	const today = scenarioDate(w.env.ports.clock.now());
	const done = async (extra: Partial<Played> = {}): Promise<Played> => {
		const s = await w.state();
		const orders = Object.values(s.orders);
		return {
			plans: Object.values(s.plans),
			receipts: orders.length,
			committedFor: orders.map((o) => s.plans[o.planId]?.deliverBy ?? '?'),
			said: '',
			...extra
		};
	};
	try {
		if (path === 'request') {
			const k = (await w.env.ports.store.kitchens(w.env.workspaceId)).find(
				(x) => x.id === kitchen
			)!;
			const r = await runRequest(text, {
				handlers: w.handlers,
				ctx: w.ctx('kitchen_agent'),
				today,
				kitchen: k,
				llm: null,
				llmKind: 'fixture',
				place: true,
				clock: w.env.ports.clock
			});
			const said = [
				r.message,
				...r.parsed.notes,
				...r.parsed.ambiguities,
				r.order?.deliveryNote,
				...(r.lookup?.items.flatMap((x) => [x.question, x.pick?.skipped]) ?? [])
			]
				.filter(Boolean)
				.join(' | ');
			return done({ event: r.event, error: r.message, said });
		}
		const run = await runGoal({
			goal: text,
			principal: w.principal({ kitchenIds: [kitchen], id: `fidelity-${id}` }),
			handlers: w.handlers,
			planner: scriptedPlanner(),
			source: { ...w.source, today: () => today }
		});
		const out = await done({ said: run.summary });
		return out.plans.length
			? out
			: { ...out, error: `agent stopped ${run.stopped}: ${run.summary.slice(0, 160)}` };
	} catch (e) {
		return done({ error: (e as Error).message.slice(0, 120) });
	}
}
