import type { DomainError, Product, ToolName } from '$lib/core/contracts';
import { routineCandidates } from './routine';
import type { Intent } from './types';

/**
 * Evidence separation: what the planner reads about a tool result. Raw tool outputs carry catalogue and
 * supplier text (names, vendors, labels, explanations) that nobody on our side wrote; the planner gets
 * only typed, length-bounded facts: ids, short names, quantities, cents, states, availability kinds and
 * reason codes. Full results stay in the trace for humans. This bounds what a planted instruction can
 * say to the planner; it is not a claim that text filtering stops injection. What stops damage is the
 * gate: scopes, the intent's tool list, the kitchen grant and the core's mandate checks.
 * A list cut at its cap says so: the parent object gets `truncated: { <field>: <full length> }`, so the
 * planner never mistakes the first 40 lines for the whole plan.
 */

/** Longest free text a fact may carry (a short product name). */
export const MAX_TEXT = 40;
const MAX_ITEMS = 40;
const MAX_REASONS = 4;

/** Short single-line text: control characters and brackets dropped, whitespace collapsed, cut to `max`. */
export function shortText(v: unknown, max = MAX_TEXT): string | undefined {
	if (typeof v !== 'string') return undefined;
	const s = v
		.replace(/[\p{C}{}<>[\]`"\\]/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Ids and codes: only id-like characters survive. */
function code(v: unknown, max = 64): string | undefined {
	if (typeof v !== 'string' && typeof v !== 'number') return undefined;
	return String(v)
		.replace(/[^\w.:-]/g, '')
		.slice(0, max);
}
function num(v: unknown): number | undefined {
	return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
function codes(v: unknown): string[] {
	return Array.isArray(v) ? v.slice(0, MAX_REASONS).map((x) => code(x, 48) ?? '') : [];
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});

/** Full lengths of the lists cut at their cap, by field. */
type Cut = Record<string, number>;

/** The first `max` items of a list; records the full length in `cut` when that drops any. */
function cap(v: unknown, field: string, cut: Cut, max = MAX_ITEMS): unknown[] {
	if (!Array.isArray(v)) return [];
	if (v.length > max) cut[field] = v.length;
	return v.slice(0, max);
}
const marked = <T extends object>(o: T, cut: Cut): T & { truncated?: Cut } =>
	Object.keys(cut).length ? { ...o, truncated: cut } : o;

export interface PlanFacts {
	id: string;
	version: number;
	state: string;
	kitchenId: string;
	totalCents: number | null;
	lines: {
		id: string;
		needId?: string;
		productId: string;
		name?: string;
		qty: number;
		unit: string;
		state: string;
		reasons: string[];
		lineCents?: number;
		substituteFor?: string;
	}[];
	needs: { id: string; label?: string }[];
	/** Present when lines or needs were cut at the cap: their full counts. */
	truncated?: Cut;
}

export function planFacts(p: unknown): PlanFacts {
	const plan = obj(p);
	const cut: Cut = {};
	return marked(
		{
			id: code(plan.id) ?? '',
			version: num(plan.version) ?? 0,
			state: code(plan.state) ?? '',
			kitchenId: code(plan.kitchenId) ?? '',
			totalCents: num(plan.totalCents) ?? null,
			lines: cap(plan.lines, 'lines', cut).map((x) => {
				const l = obj(x);
				const qty = obj(l.qty);
				return {
					id: code(l.id, 128) ?? '',
					needId: code(l.needId, 128),
					productId: code(l.productId) ?? '',
					name: shortText(l.productName),
					qty: num(qty.value) ?? 0,
					unit: code(qty.unit, 8) ?? '',
					state: code(l.state) ?? '',
					reasons: codes(l.reasons),
					lineCents: num(l.lineCents),
					substituteFor: code(l.substituteFor)
				};
			}),
			needs: cap(plan.needs, 'needs', cut).map((x) => {
				const n = obj(x);
				return { id: code(n.id, 128) ?? '', label: shortText(n.label) };
			})
		},
		cut
	);
}

export type Facts = Obj;

/**
 * Typed facts of one tool result, per tool. Unknown shapes reduce to nothing rather than to raw text.
 * For a routine order, search results are ranked against the request and carry how many sales units
 * the asked quantity is for each product (the request parser's conversion), or why it can't be said.
 */
export function toFacts(tool: ToolName, value: unknown, intent?: Intent): Facts {
	const v = obj(value);
	const cut: Cut = {};
	switch (tool) {
		case 'search_products':
			if (intent?.kind === 'routine_order')
				return routineCandidates(
					intent,
					(Array.isArray(v.products) ? v.products : []) as Product[]
				);
			return marked(
				{
					products: cap(v.products, 'products', cut, 10).map((x) => {
						const p = obj(x);
						return {
							productId: code(p.productId),
							name: shortText(obj(p.nameShort).value ?? p.nameFi),
							unit: code(p.salesUnit, 8),
							lotStep: num(p.lotStep),
							origin: code(p.origin, 2)
						};
					})
				},
				cut
			);
		case 'quote':
			return marked(
				{
					offers: cap(v.offers, 'offers', cut).map((x) => {
						const o = obj(x);
						return {
							productId: code(o.productId),
							unitCents: num(obj(o.price).unitCents),
							availability: code(obj(o.availability).kind, 16)
						};
					}),
					notFound: cap(v.notFound, 'notFound', cut).map((x) => code(x))
				},
				cut
			);
		case 'plan_event':
		case 'edit_line':
			return { plan: planFacts(v.plan) };
		case 'place_order':
			return { plan: planFacts(v.plan), approvalId: code(v.approvalId, 128) ?? null };
		case 'get_plan': {
			const a = v.approval ? obj(v.approval) : null;
			return marked(
				{
					plan: planFacts(v.plan),
					approval: a
						? {
								id: code(a.id, 128),
								state: code(a.state),
								tier: code(a.tier),
								lineIds: cap(a.lineIds, 'approvalLineIds', cut).map((x) => code(x, 128))
							}
						: null
				},
				cut
			);
		}
		case 'find_substitutes':
			return marked(
				{
					plan: planFacts(v.plan),
					kind: code(v.kind, 16),
					chosen: cap(v.chosen, 'chosen', cut).map((x) => code(obj(x).id, 128)),
					candidates: cap(v.candidates, 'candidates', cut, 5).map((x) => {
						const c = obj(x);
						return {
							productId: code(c.productId),
							name: shortText(c.productName),
							rank: num(c.rank) ?? null,
							// A CAUTION.* reason is a model caution on a selectable candidate (its line is held for a human),
							// not a rejection.
							rejected: codes(c.rejectedReasons).filter((r) => !r.startsWith('CAUTION.')),
							cautions: codes(c.rejectedReasons).filter((r) => r.startsWith('CAUTION.'))
						};
					})
				},
				cut
			);
		case 'explain_line':
			// The steps are prose built from catalogue text: the planner gets their sources only.
			return marked(
				{
					steps: Array.isArray(v.steps) ? v.steps.length : 0,
					sources: cap(v.steps, 'sources', cut).map((x) => code(obj(x).source, 48))
				},
				cut
			);
		case 'commit_order':
			return marked(
				{
					orderId: code(v.orderId, 128),
					receiptId: code(v.receiptId, 128),
					totalCents: num(v.totalCents),
					committedLineIds: cap(v.committedLineIds, 'committedLineIds', cut).map((x) =>
						code(x, 128)
					),
					awaitingSupplier: cap(v.awaitingSupplier, 'awaitingSupplier', cut).map((x) =>
						code(x, 128)
					)
				},
				cut
			);
		case 'approve':
			return { state: code(v.state) };
		case 'set_mandate':
			return { mandateVersion: num(v.mandateVersion) };
		case 'get_context':
			return {
				kitchens: Array.isArray(v.kitchens) ? v.kitchens.length : 0,
				openPlans: Array.isArray(v.openPlans) ? v.openPlans.length : 0
			};
		// Web results are text from pages nobody on our side wrote: the planner gets counts and field
		// codes only, never the values, titles or URLs (those stay in the trace and the UI).
		case 'lookup_facts': {
			const fs = Array.isArray(v.facts) ? v.facts.map(obj) : [];
			return {
				facts: fs.length,
				fields: fs.slice(0, MAX_REASONS * 2).map((f) => code(f.field, 32) ?? ''),
				gtinCited: fs.filter((f) => f.gtinCited === true).length,
				cached: v.cached === true
			};
		}
		case 'find_outside':
			return { options: Array.isArray(v.options) ? v.options.length : 0 };
		case 'check_recall': {
			const ns = Array.isArray(v.notices) ? v.notices.map(obj) : [];
			const real = ns.filter((n) => n.drill !== true);
			return {
				notices: ns.length,
				gtin: real.filter((n) => n.match === 'gtin').length,
				name: real.filter((n) => n.match === 'name').length,
				drills: ns.filter((n) => n.drill === true && n.match !== 'none').length
			};
		}
	}
}

/** A failed call as the planner sees it: the closed error code and a short message. */
export function errorFacts(
	e: DomainError | undefined
): { code: string; message?: string } | undefined {
	return e ? { code: e.code, message: shortText(e.message, 120) } : undefined;
}
