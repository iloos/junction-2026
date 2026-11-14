/**
 * Request → Lookup → Order, through the one tool gate (serveTool) as the caller's context, so the
 * same scopes, validation and idempotency apply as for MCP and REST. Valio is touched only by
 * `quote`, and only for the shortlisted ids (plus Valio's own substitute rule for the pick).
 */
import type { Kitchen, Offer, Product, ToolName, ToolOutput } from '$lib/core/contracts';
import { canonicalJson, sha256Hex } from '$lib/core/hash';
import type { CallContext, Llm, ToolHandlers } from '$lib/core/ports';
import { serveTool } from '$lib/server/tools/serve';
import type {
	ApprovalView,
	CandidateView,
	LookupItemView,
	LookupView,
	OrderView,
	ParsedView,
	RequestEvent,
	RequestResult,
	ValioRuleView
} from '$lib/ui/request/types';
import { weekdayOf } from './dates';
import { rankCandidates, SHORTLIST, unpickable, type Ranked } from './lookup';
import { parseRequest, type ParsedRequest } from './parse';

export class ToolFailed extends Error {
	constructor(
		readonly tool: string,
		readonly code: string,
		message: string
	) {
		super(`${tool}: ${code} ${message}`);
	}
}

/** One tool call through the gate; throws ToolFailed with the domain error. */
export async function callTool<N extends ToolName>(
	handlers: ToolHandlers,
	ctx: CallContext,
	name: N,
	input: unknown
): Promise<ToolOutput<N>> {
	const r = await serveTool(name, ctx, input, handlers);
	if (!r.ok) throw new ToolFailed(name, r.error.code, r.error.message);
	return r.value as ToolOutput<N>;
}

export interface ApprovalRecord {
	mandateVersion: number;
	expiresAt: string;
	requestedBy: string;
	decidedBy?: string;
}

export interface RequestDeps {
	handlers: ToolHandlers;
	/** Who places the order (kitchen_agent for the page; the key's actor for the API). */
	ctx: CallContext;
	/** The simulator clock's Helsinki date. */
	today: string;
	kitchen: Kitchen;
	llm?: Llm | null;
	llmKind?: ParsedRequest['parser']['kind'];
	/** Makes two submissions of the same words distinct orders; the same nonce replays the same plan. */
	nonce?: string;
	/** Stop after lookup (no plan is created). */
	place?: boolean;
	/** Approval fields get_plan does not return (mandate version, expiry). */
	approvalRecord?: (id: string) => Promise<ApprovalRecord | null>;
	onEvent?: (e: RequestEvent) => void;
}

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

function candidateView(r: Ranked, offer: Offer | null, quoted: boolean): CandidateView {
	const c = r.conversion;
	return {
		productId: r.product.productId,
		name: r.product.nameFi,
		score: r.score,
		reasons: r.reasons,
		salesUnit: r.product.salesUnit,
		conversion: c
			? c.ok
				? {
						ok: true,
						salesQty: c.salesQty,
						explain: c.explain,
						exact: c.exact,
						warnings: c.warnings
					}
				: { ok: false, reason: c.reason }
			: null,
		offer,
		skipped: null,
		picked: false,
		quoted
	};
}

async function lookupItems(parsed: ParsedRequest, d: RequestDeps): Promise<LookupView> {
	let searchCalls = 0;
	const prepared: {
		item: ParsedRequest['items'][number];
		searches: { query: string; hits: number }[];
		ranked: Ranked[];
		rejected: { productId: string; name: string; reason: string }[];
	}[] = [];

	for (const item of parsed.items) {
		const hits: Product[] = [];
		const searches: { query: string; hits: number }[] = [];
		for (const q of item.search) {
			const r = await callTool(d.handlers, d.ctx, 'search_products', { query: q, limit: 50 });
			searchCalls++;
			searches.push({ query: q, hits: r.products.length });
			hits.push(...r.products);
		}
		const { ranked, rejected } = rankCandidates(item, hits);
		prepared.push({ item, searches, ranked, rejected });
	}

	// One quote call for every shortlist that can be ordered (has a quantity), plus Valio's own
	// substitute rules for each item's leading candidate.
	const want = new Set<string>();
	for (const p of prepared) {
		if (p.item.qty === null) continue;
		for (const r of p.ranked.slice(0, SHORTLIST)) want.add(r.product.productId);
		for (const s of p.ranked[0]?.product.valioSubstitutes ?? []) want.add(s);
	}
	const offers = new Map<string, Offer>();
	if (want.size) {
		const q = await callTool(d.handlers, d.ctx, 'quote', {
			productIds: [...want],
			deliverBy: parsed.deliverBy
		});
		for (const o of q.offers) offers.set(o.productId, o);
	}

	const items: LookupItemView[] = prepared.map((p) => {
		const short = p.ranked.slice(0, SHORTLIST);
		const views = short.map((r) =>
			candidateView(r, offers.get(r.product.productId) ?? null, offers.has(r.product.productId))
		);
		let pick: CandidateView | null = null;
		for (const [i, v] of views.entries()) {
			if (p.item.qty === null) break;
			const why = unpickable(offers.get(v.productId), short[i].conversion);
			if (why) v.skipped = why;
			else if (!pick) {
				v.picked = true;
				pick = v;
				break;
			}
		}
		let question: string | null = null;
		if (p.item.qty === null) question = `How much ${p.item.query}?`;
		else if (!short.length)
			question = `Nothing in the catalogue matched "${p.item.query}". Which product do you mean?`;
		else if (!pick) {
			const conv = views.find((v) => v.conversion && !v.conversion.ok);
			question =
				conv && conv.conversion && !conv.conversion.ok
					? `${conv.name}: ${conv.conversion.reason}.`
					: `None of the ${views.length} matches can be delivered for ${parsed.deliverBy}. Pick another product or date?`;
		}

		// Valio's own substitute rules for the pick (or the leading candidate): shown, never proposed.
		const lead = pick ? short.find((r) => r.product.productId === pick!.productId) : short[0];
		const valioRules: ValioRuleView[] = (lead?.product.valioSubstitutes ?? []).map((to) => {
			const o = offers.get(to);
			const name =
				p.ranked.find((r) => r.product.productId === to)?.product.nameFi ??
				p.rejected.find((r) => r.productId === to)?.name ??
				null;
			if (!o)
				return {
					from: lead!.product.productId,
					to,
					toName: name,
					status: 'not_quoted',
					reason: 'not quoted'
				};
			const why = unpickable(o, {
				ok: true,
				salesQty: 0,
				salesUnit: '',
				explain: '',
				exact: true,
				perSalesUnit: null,
				warnings: []
			});
			return why
				? { from: lead!.product.productId, to, toName: name, status: 'skipped', reason: why }
				: {
						from: lead!.product.productId,
						to,
						toName: name,
						status: 'available',
						reason: 'deliverable; kept as a fallback, not ordered'
					};
		});
		// A rule target that is undeliverable must not show as pickable in the shortlist either.
		for (const v of views)
			if (valioRules.some((r) => r.to === v.productId && r.status === 'skipped') && !v.skipped)
				v.skipped = valioRules.find((r) => r.to === v.productId)!.reason;

		return {
			item: p.item,
			searches: p.searches,
			shortlist: views,
			rejected: p.rejected.slice(0, 6),
			rejectedCount: p.rejected.length,
			pick,
			question,
			valioRules
		};
	});

	const offerSources = [
		...new Set(
			[...offers.values()]
				.flatMap((o) => [o.price?.provenance.source, o.availability.provenance.source])
				.filter((s): s is NonNullable<typeof s> => !!s)
		)
	];
	return { items, searchCalls, quotedIds: [...offers.keys()], offerSources };
}

export async function idempotencyKeyFor(
	kitchenId: string,
	deliverBy: string,
	lines: unknown,
	nonce = ''
): Promise<string> {
	return `rq-${(await sha256Hex(canonicalJson({ kitchenId, deliverBy, lines, nonce }))).slice(0, 20)}`;
}

/** get_plan's approval plus the fields it does not carry, read from the approval record. */
export async function approvalView(
	handlers: ToolHandlers,
	ctx: CallContext,
	planId: string,
	record?: RequestDeps['approvalRecord']
): Promise<{ plan: ToolOutput<'get_plan'>['plan']; approval: ApprovalView | null }> {
	const g = await callTool(handlers, ctx, 'get_plan', { planId });
	const a = g.approval;
	if (!a) return { plan: g.plan, approval: null };
	const rec = record ? await record(a.id) : null;
	const ids = new Set(a.lineIds);
	return {
		plan: g.plan,
		approval: {
			id: a.id,
			state: a.state,
			tier: a.tier,
			planVersion: a.planVersion,
			termsHash: a.termsHash,
			lineIds: a.lineIds,
			totalCents: g.plan.lines
				.filter((l) => ids.has(l.id))
				.reduce((s, l) => s + (l.lineCents ?? 0), 0),
			mandateVersion: rec?.mandateVersion ?? null,
			expiresAt: rec?.expiresAt ?? null,
			requestedBy: rec?.requestedBy ?? null,
			decidedBy: rec?.decidedBy ?? null
		}
	};
}

/** Runs the request flow and reports each step as it finishes. */
export async function runRequest(text: string, d: RequestDeps): Promise<RequestResult> {
	const emit = (e: RequestEvent) => d.onEvent?.(e);
	let t0 = performance.now();
	const ms = () => {
		const n = Math.round(performance.now() - t0);
		t0 = performance.now();
		return n;
	};

	const parsed = await parseRequest(text, { today: d.today, llm: d.llm, llmKind: d.llmKind });
	const parsedView = parsed as ParsedView;
	const askFirst = parsed.items.length === 0;
	emit({
		step: 'request',
		status: askFirst
			? 'blocked'
			: parsed.ambiguities.length || parsed.items.some((i) => i.ambiguities.length)
				? 'warn'
				: 'done',
		ms: ms(),
		data: parsedView
	});
	if (askFirst)
		return {
			parsed: parsedView,
			lookup: null,
			order: null,
			message: 'No item found in the request.'
		};

	const lookup = await lookupItems(parsed, d);
	const picks = lookup.items.filter((i) => i.pick);
	emit({
		step: 'lookup',
		status: picks.length === 0 ? 'blocked' : picks.length < lookup.items.length ? 'warn' : 'done',
		ms: ms(),
		data: lookup
	});
	if (picks.length === 0)
		return {
			parsed: parsedView,
			lookup,
			order: null,
			message: 'Nothing to order yet: answer the questions above.'
		};
	if (d.place === false)
		return { parsed: parsedView, lookup, order: null, message: 'Lookup only (place=false).' };

	const lines = picks.map((i) => ({
		productId: i.pick!.productId,
		qty: (i.pick!.conversion as { salesQty: number }).salesQty,
		unit: i.pick!.salesUnit
	}));
	const idempotencyKey = await idempotencyKeyFor(d.kitchen.id, parsed.deliverBy, lines, d.nonce);
	try {
		const placed = await callTool(d.handlers, d.ctx, 'place_order', {
			kitchenId: d.kitchen.id,
			deliverBy: parsed.deliverBy,
			idempotencyKey,
			lines
		});
		const { plan, approval } = await approvalView(
			d.handlers,
			d.ctx,
			placed.plan.id,
			d.approvalRecord
		);
		const dow = DAY_KEYS[weekdayOf(parsed.deliverBy)];
		const order: OrderView = {
			idempotencyKey,
			plan,
			approval,
			replayed:
				plan.version !== placed.plan.version || plan.lines.some((l) => l.state === 'committed'),
			kitchen: {
				id: d.kitchen.id,
				name: d.kitchen.name,
				mandateWords: d.kitchen.mandate.words,
				lineCapCents: d.kitchen.mandate.lineCapCents,
				orderCapCents: d.kitchen.mandate.orderCapCents,
				weeklyCapCents: d.kitchen.mandate.weeklyCapCents,
				mandateVersion: d.kitchen.mandate.version
			},
			deliveryNote: d.kitchen.deliveryDays.includes(dow)
				? null
				: `${d.kitchen.name} takes deliveries on ${d.kitchen.deliveryDays.join(', ')}; ${parsed.deliverBy} is a ${dow}`
		};
		const held = plan.lines.some((l) => l.state === 'held');
		emit({
			step: 'order',
			status: held || order.deliveryNote ? 'warn' : 'done',
			ms: ms(),
			data: order
		});
		return { parsed: parsedView, lookup, order };
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		emit({ step: 'order', status: 'error', ms: ms(), data: null, message });
		return { parsed: parsedView, lookup, order: null, message };
	}
}
