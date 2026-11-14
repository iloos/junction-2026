import type { DomainError, ToolName } from '$lib/core/contracts';

/**
 * Evidence separation: what the planner reads about a tool result. Raw tool outputs carry catalogue and
 * supplier text (names, vendors, labels, explanations) that nobody on our side wrote; the planner gets
 * only typed, length-bounded facts: ids, short names, quantities, cents, states, availability kinds and
 * reason codes. Full results stay in the trace for humans. This bounds what a planted instruction can
 * say to the planner; it is not a claim that text filtering stops injection. What stops damage is the
 * gate: scopes, the intent's tool list, the kitchen grant and the core's mandate checks.
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
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v.slice(0, MAX_ITEMS) : []);

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
}

export function planFacts(p: unknown): PlanFacts {
	const plan = obj(p);
	return {
		id: code(plan.id) ?? '',
		version: num(plan.version) ?? 0,
		state: code(plan.state) ?? '',
		kitchenId: code(plan.kitchenId) ?? '',
		totalCents: num(plan.totalCents) ?? null,
		lines: arr(plan.lines).map((x) => {
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
		needs: arr(plan.needs).map((x) => {
			const n = obj(x);
			return { id: code(n.id, 128) ?? '', label: shortText(n.label) };
		})
	};
}

export type Facts = Obj;

/** Typed facts of one tool result, per tool. Unknown shapes reduce to nothing rather than to raw text. */
export function toFacts(tool: ToolName, value: unknown): Facts {
	const v = obj(value);
	switch (tool) {
		case 'search_products':
			return {
				products: arr(v.products)
					.slice(0, 10)
					.map((x) => {
						const p = obj(x);
						return {
							productId: code(p.productId),
							name: shortText(obj(p.nameShort).value ?? p.nameFi),
							unit: code(p.salesUnit, 8),
							lotStep: num(p.lotStep),
							origin: code(p.origin, 2)
						};
					})
			};
		case 'quote':
			return {
				offers: arr(v.offers).map((x) => {
					const o = obj(x);
					return {
						productId: code(o.productId),
						unitCents: num(obj(o.price).unitCents),
						availability: code(obj(o.availability).kind, 16)
					};
				}),
				notFound: arr(v.notFound).map((x) => code(x))
			};
		case 'plan_event':
		case 'edit_line':
			return { plan: planFacts(v.plan) };
		case 'place_order':
			return { plan: planFacts(v.plan), approvalId: code(v.approvalId, 128) ?? null };
		case 'get_plan': {
			const a = v.approval ? obj(v.approval) : null;
			return {
				plan: planFacts(v.plan),
				approval: a
					? {
							id: code(a.id, 128),
							state: code(a.state),
							tier: code(a.tier),
							lineIds: arr(a.lineIds).map((x) => code(x, 128))
						}
					: null
			};
		}
		case 'find_substitutes':
			return {
				plan: planFacts(v.plan),
				kind: code(v.kind, 16),
				chosen: arr(v.chosen).map((x) => code(obj(x).id, 128)),
				candidates: arr(v.candidates)
					.slice(0, 5)
					.map((x) => {
						const c = obj(x);
						return {
							productId: code(c.productId),
							name: shortText(c.productName),
							rank: num(c.rank) ?? null,
							rejected: codes(c.rejectedReasons)
						};
					})
			};
		case 'explain_line':
			// The steps are prose built from catalogue text: the planner gets their sources only.
			return {
				steps: arr(v.steps).length,
				sources: arr(v.steps).map((x) => code(obj(x).source, 48))
			};
		case 'commit_order':
			return {
				orderId: code(v.orderId, 128),
				receiptId: code(v.receiptId, 128),
				totalCents: num(v.totalCents),
				committedLineIds: arr(v.committedLineIds).map((x) => code(x, 128)),
				awaitingSupplier: arr(v.awaitingSupplier).map((x) => code(x, 128))
			};
		case 'approve':
			return { state: code(v.state) };
		case 'set_mandate':
			return { mandateVersion: num(v.mandateVersion) };
	}
}

/** A failed call as the planner sees it: the closed error code and a short message. */
export function errorFacts(
	e: DomainError | undefined
): { code: string; message?: string } | undefined {
	return e ? { code: e.code, message: shortText(e.message, 120) } : undefined;
}
