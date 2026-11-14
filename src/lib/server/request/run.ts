/**
 * Request → Lookup → Order, through the one tool gate (serveTool) as the caller's context, so the
 * same scopes, validation and idempotency apply as for MCP and REST. Valio is touched only by
 * `quote`, and only for the shortlisted ids (plus Valio's own substitute rule for the pick).
 */
import type {
	Kitchen,
	Measure,
	NeedAsk,
	NeedRequirements,
	Offer,
	Product,
	ToolName,
	ToolOutput
} from '$lib/core/contracts';
import { sizeDirect } from '$lib/core/demand/sizing';
import { addDays } from '$lib/core/scenario';
import { day, money, num, readableName } from '$lib/ui/format';
import { canonicalJson, sha256Hex } from '$lib/core/hash';
import type { CallContext, Clock, Llm, TaskStore, ToolHandlers } from '$lib/core/ports';
import { taskForPlan } from './task';
import { preferenceNote, preferenceOrder, priceBasis, type RankBy } from './rank-by';

/** The sales quantity a candidate needs for the request (after lot rounding), 0 when it can't be sized. */
const qtyOf = (r: Ranked) => (r.conversion?.ok ? r.conversion.salesQty : 0);
import { serveTool } from '$lib/server/tools/serve';
import type {
	AnswerSpec,
	ApprovalView,
	BriefAnswer,
	RequestAnswer,
	CandidateView,
	EventView,
	LookupItemView,
	LookupView,
	OrderView,
	ParsedView,
	RequestEvent,
	RequestResult,
	ValioRuleView
} from '$lib/ui/request/types';
import { salesUnitWords } from '$lib/ui/request/words';
import { weekdayOf } from './dates';
import { cutoffSentence, deliveryDays, firstOpenDay, itemOnDate, type DayCandidate } from './days';
import { caseBreakdown, caseHeadline, orderAmount } from './convert';
import { hardLimit, sanityWarnings } from './sanity';
import { hardLimitCents } from '$lib/core/mandate/validate';
import {
	closesWords,
	cutoffPassed,
	filterHits,
	requirementsOf,
	ROUNDING_LIMIT,
	SHORTLIST,
	unpickable,
	type Ranked
} from './lookup';
import { parseRequest, parseRules, type ParsedRequest } from './parse';
import { dishItems, interpretDish, type DishInterpretation } from './dish';
import { readingOf, reviewReading } from './reading';
import { howMuchWords, maxAvailable, unitsFor } from './amount';
import { requestParseCheckpoint, withReview, type ReviewDeps } from '$lib/server/review';
import { classifyRequest } from './classify';
import { applyBriefAnswers, draftBrief, nextQuestion } from '../menu/brief';

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

export interface RequestDeps {
	handlers: ToolHandlers;
	/** Who places the order (kitchen_agent for the page; the key's actor for the API). */
	ctx: CallContext;
	/** The simulator clock's Helsinki date. */
	today: string;
	kitchen: Kitchen;
	llm?: Llm | null;
	/** The stronger model a doubtful first reading is escalated to (D12 cascade); absent: no second pass. */
	escalate?: Llm | null;
	llmKind?: ParsedRequest['parser']['kind'];
	/** Makes two submissions of the same words distinct orders; the same nonce replays the same plan. */
	nonce?: string;
	/** Stop after lookup (no plan is created). */
	place?: boolean;
	/** The chef's inline answers to earlier questions, by item id. */
	answers?: RequestAnswer[];
	/** The chef's answers to event-brief questions, by question id. */
	briefAnswers?: BriefAnswer[];
	/** The chef saw the size warnings and wants the order placed anyway. */
	confirmLarge?: boolean;
	onEvent?: (e: RequestEvent) => void;
	/** Set when the parse is reviewed (REVIEW=1): the reviewer's deps (Decide, trace, budget). */
	review?: ReviewDeps;
	/**
	 * The workspace's store clock (ports.clock, the scenario clock on the server): the one "now" for cut-offs and task
	 * times, the same one place_order and commit judge by. Absent (and no `now`): lookup leaves cut-offs to place_order.
	 */
	clock?: Pick<Clock, 'now'>;
	/** A per-request ranking preference for the lookup (Rank by); never saved to the kitchen. */
	rankBy?: RankBy;
	/** A fixed instant instead of `clock`, for tests. */
	now?: Date;
	/** Procurement tasks (ports.tasks); absent: no task is stored and the result still links the plan. */
	tasks?: TaskStore;
	/** The chef chose this delivery date instead of the one the words gave (a cut-off answer). Shown, never silent. */
	deliverBy?: string;
	/**
	 * A dish request: which way to serve it (default: the kitchen's preference), portions the chef edited, or `packs`
	 * when the chef said the count is packs of a product, not portions.
	 */
	dish?: { option?: 'ready' | 'raw'; portions?: number; packs?: boolean };
	/**
	 * The chef edited the reading in place (an item's quantity, unit or words): these items replace the parse, so the
	 * words are not read again and only the steps after it run.
	 */
	items?: ParsedRequest['items'];
}

/** The request's one "now": the override, else the workspace's store clock. */
const nowOf = (d: Pick<RequestDeps, 'now' | 'clock'>): Date | undefined => d.now ?? d.clock?.now();

/** The first day after `date` the kitchen takes deliveries on, within two weeks. */
export function nextReceivingDay(date: string, days: readonly string[]): string | null {
	for (let k = 1; k <= 14; k++) {
		const d = addDays(date, k);
		if (days.includes(DAY_KEYS[weekdayOf(d)])) return d;
	}
	return null;
}

/**
 * The first receiving day after `date` whose cut-off is still open for the picked products at `now`; without a
 * clock, the first receiving day.
 */
export function nextOpenReceivingDay(
	date: string,
	days: readonly string[],
	cands: readonly (readonly DayCandidate[])[],
	now: Date | undefined
): string | null {
	if (!now) return nextReceivingDay(date, days);
	const d = firstOpenDay(cands, date, now, days);
	return d && d.receiving ? d.date : null;
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/** Each distinct reason the candidates were passed over, with how many: "2 out of stock at Valio". */
export function skipSummary(views: Pick<CandidateView, 'skipped'>[]): string {
	const n = new Map<string, number>();
	for (const v of views) {
		const r = v.skipped ?? 'not quoted';
		n.set(r, (n.get(r) ?? 0) + 1);
	}
	return [...n].map(([r, k]) => `${k} ${r}`).join('; ');
}

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

async function lookupItems(
	parsed: ParsedRequest,
	d: RequestDeps
): Promise<{ lookup: LookupView; picked: Map<string, Product>; cands: DayCandidate[][] }> {
	let searchCalls = 0;
	const now = nowOf(d);
	const rankBy = d.rankBy ?? 'kitchen';
	const prepared: {
		item: ParsedRequest['items'][number];
		searches: { query: string; hits: number }[];
		ranked: Ranked[];
		rejected: { productId: string; name: string; reason: string }[];
		pin: string | null;
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
		const { ranked, rejected } = filterHits(item, hits);
		const pinned = d.answers?.find((a) => a.item === item.id);
		const pin = pinned?.productId ?? null;
		// The chosen product leads the shortlist, with the chef named as the reason.
		const at = pin ? ranked.findIndex((r) => r.product.productId === pin) : -1;
		if (at > 0) ranked.unshift(...ranked.splice(at, 1));
		if (at >= 0)
			ranked[0] = {
				...ranked[0],
				reasons: [pinned?.why ?? 'you chose this', ...ranked[0].reasons]
			};
		prepared.push({ item, searches, ranked, rejected, pin });
	}

	// One quote call for every shortlist that can be ordered (has a quantity), plus Valio's own
	// substitute rules for each item's leading candidate.
	const want = new Set<string>();
	for (const p of prepared) {
		if (p.item.qty === null && p.item.amount?.kind !== 'max_available') continue;
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

	const picked = new Map<string, Product>();
	// What each item could be ordered as: the one input to every date the page offers or names.
	const cands: DayCandidate[][] = prepared.map((p) =>
		p.ranked.slice(0, SHORTLIST).map((r) => ({
			product: r.product,
			offer: offers.get(r.product.productId),
			conversion: r.conversion
		}))
	);
	const items: LookupItemView[] = prepared.map((p, pi) => {
		const short = p.ranked.slice(0, SHORTLIST);
		const views = short.map((r) =>
			candidateView(r, offers.get(r.product.productId) ?? null, offers.has(r.product.productId))
		);
		const pin = p.pin;
		// A case is a different size for every product: without the chef saying which, ask.
		const askCase = p.item.unit === 'case' && !pin && p.item.qty !== null;
		let pick: CandidateView | null = null;
		// The kitchen default picks in shortlist order; a "Rank by" preference re-orders the quoted shortlist first.
		const pickableAt = (i: number) =>
			p.item.qty !== null &&
			!askCase &&
			(!pin || views[i].productId === pin) &&
			!unpickable(offers.get(views[i].productId), short[i].conversion, now);
		const defaultAt = views.findIndex((_, i) => pickableAt(i));
		const order =
			(!pin &&
				!askCase &&
				preferenceOrder(
					rankBy,
					d.kitchen,
					short.map((r) => ({
						product: r.product,
						qty: r.conversion?.ok ? r.conversion.salesQty : 0
					})),
					offers
				)) ||
			views.map((_, i) => i);
		for (const i of order) {
			const v = views[i];
			if (p.item.qty === null) break;
			if (pin && v.productId !== pin) continue;
			const why = unpickable(offers.get(v.productId), short[i].conversion, now);
			if (why) v.skipped = why;
			else if (!pick && !askCase) {
				v.picked = true;
				v.amount = v.conversion?.ok ? orderAmount(short[i].product, v.conversion.salesQty) : null;
				pick = v;
				picked.set(p.item.id, short[i].product);
				break;
			}
		}
		// The smallest order far over the ask (5 l for 250 ml) holds with a question, unless the chef already took it.
		let roundingHold: string | null = null;
		const pickedAt = pick ? views.indexOf(pick) : -1;
		const over = pickedAt >= 0 ? (short[pickedAt].overshoot ?? null) : null;
		const accepted = d.answers?.find((a) => a.item === p.item.id)?.acceptRounding === true;
		if (pick && over !== null && over > ROUNDING_LIMIT && !accepted) {
			const conv = pick.conversion as { salesQty: number };
			const a = pick.amount;
			roundingHold = `The smallest you can order of ${readableName(pick.name)} is ${salesUnitWords(conv.salesQty, pick.salesUnit)}${a ? ` = ${num(a.value, 3)} ${a.unit}` : ''} (${num(over, 1)}× what you asked). Order it, or pick another product?`;
			pick.picked = false;
			pick = null;
			picked.delete(p.item.id);
		}
		const chosenAt = pick ? views.indexOf(pick) : -1;
		const rankNote =
			chosenAt >= 0
				? preferenceNote(
						rankBy,
						{
							product: short[chosenAt].product,
							offer: offers.get(views[chosenAt].productId),
							qty: qtyOf(short[chosenAt])
						},
						defaultAt >= 0
							? {
									product: short[defaultAt].product,
									offer: offers.get(views[defaultAt].productId),
									qty: qtyOf(short[defaultAt])
								}
							: null,
						priceBasis(
							short.map((r) => ({ product: r.product, qty: qtyOf(r) })),
							offers
						)
					)
				: null;
		let question: string | null = null;
		let answer: AnswerSpec | null = null;
		const idx = p.item.id;
		const closed = short
			.map((r) => offers.get(r.product.productId))
			.filter((o): o is Offer => !!o && !!now && cutoffPassed(o, now) !== null)
			// The latest cut-off that closed first: the one that came closest to this date.
			.sort((a, b) => b.availability.closingTime!.localeCompare(a.availability.closingTime!));
		// Nothing on the shortlist can be ordered now, and ordering for this date closed for some of it.
		const allClosed =
			closed.length > 0 &&
			!short.some((r) => !unpickable(offers.get(r.product.productId), r.conversion, now));
		if (roundingHold) {
			question = roundingHold;
			const options = short
				.map((r, i) => ({ r, v: views[i] }))
				.filter(
					({ r, v }) => r.conversion?.ok && !unpickable(offers.get(v.productId), r.conversion, now)
				)
				.slice(0, 4)
				.map(({ r }) => {
					const c = r.conversion as { salesQty: number };
					const amt = orderAmount(r.product, c.salesQty);
					return {
						label: `${salesUnitWords(c.salesQty, r.product.salesUnit)}${amt ? ` = ${num(amt.value, 3)} ${amt.unit}` : ''}`,
						detail: `${readableName(r.product.nameFi)}${r.overshoot ? ` · ${num(r.overshoot, 1)}× what you asked` : ''}`,
						answer: { item: idx, productId: r.product.productId, acceptRounding: true }
					};
				});
			answer = {
				kind: 'choice',
				item: idx,
				options,
				alsoQty: { units: unitsFor(short.map((r) => r.product)) }
			};
		} else if (p.item.qty === null) {
			// No exact amount: asked once per kind of the reading's shape (D20).
			const a = p.item.amount;
			if (a?.kind === 'max_available') {
				const m = maxAvailable(
					p.item,
					short.map((r) => ({ product: r.product, offer: offers.get(r.product.productId) })),
					d.kitchen
				);
				question = m.question;
				answer = m.answer;
			} else {
				const units = unitsFor(short.map((r) => r.product));
				question =
					a?.kind === 'for_people'
						? `${howMuchWords(p.item.query, units).replace(/\?$/, '')} for ${num(a.n)} people?`
						: howMuchWords(p.item.query, units);
				answer = { kind: 'qty', item: idx, units };
			}
		} else if (!pick && allClosed) {
			// Ordering for this date has closed: say why, offer the first date that is open for every item (and a
			// receiving day), so the button's day is the day that results. Never moved silently.
			const here = itemOnDate(cands[pi], parsed.deliverBy, now!);
			const first = firstOpenDay(cands, parsed.deliverBy, now!, d.kitchen.deliveryDays);
			question = cutoffSentence(
				parsed.deliverBy,
				here.reason ?? `past its cut-off (${closesWords(closed[0].availability.closingTime!)})`,
				first?.date ?? null
			);
			if (first)
				answer = {
					kind: 'date',
					item: idx,
					date: first.date,
					label: `Deliver ${day(first.date)} instead`
				};
		} else if (askCase) {
			const options = short
				.map((r, i) => ({ r, v: views[i] }))
				.filter(({ r, v }) => !unpickable(offers.get(v.productId), r.conversion, now))
				.slice(0, 4)
				.map(({ r, v }) => {
					// Headline and detail come from the same breakdown, so they can never disagree.
					const b = caseBreakdown(r.product, p.item.qty!);
					const unitCents = offers.get(v.productId)?.price?.unitCents ?? null;
					if ('error' in b)
						return {
							label: `${p.item.qty} cases, size not stated`,
							detail: `${r.product.nameFi} · ${b.error}`,
							answer: { item: idx, productId: r.product.productId }
						};
					const oneCase = b.perCase
						? ` · 1 case = ${b.perCase.count > 1 ? `${b.perCase.count} × ${b.perCase.each} = ` : ''}${b.perCase.total}`
						: '';
					return {
						label: caseHeadline(b),
						detail: `${r.product.nameFi}${oneCase} · ${salesUnitWords(b.salesQty, b.salesUnit)} × ${money(unitCents)} = ${money(unitCents === null ? null : unitCents * b.salesQty)}`,
						answer: { item: idx, productId: r.product.productId }
					};
				});
			question = options.length
				? `Which case? Case sizes differ between products, so ${p.item.qty} cases of ${p.item.query} could be very different amounts.`
				: `None of the matching cases can be delivered for ${day(parsed.deliverBy)}. Give the amount in kg or l?`;
			answer = {
				kind: 'choice',
				item: idx,
				options,
				alsoQty: { units: ['kg', 'l', 'pcs'] }
			};
		} else if (!short.length)
			question = `Nothing in the catalogue matched "${p.item.query}". Which product do you mean?`;
		else if (!pick && pin && !views.some((v) => v.productId === pin))
			question = `The product you chose (${pin}) is no longer in the shortlist. Pick again?`;
		else if (!pick) {
			const conv = views.find((v) => v.conversion && !v.conversion.ok);
			if (conv) answer = { kind: 'qty', item: idx, units: ['sales'], salesUnit: conv.salesUnit };
			question =
				conv && conv.conversion && !conv.conversion.ok
					? `${conv.name}: ${conv.conversion.reason}.`
					: `None of the ${views.length} matches can be ordered for ${day(parsed.deliverBy)}: ${skipSummary(views)}. Pick another product or date?`;
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
			...(roundingHold ? { hold: 'need_rounding_large' as const } : {}),
			item: p.item,
			searches: p.searches,
			shortlist: views,
			rejected: p.rejected.slice(0, 6),
			rejectedCount: p.rejected.length,
			pick,
			question,
			answer,
			valioRules,
			...(rankNote ? { rankNote } : {})
		};
	});

	const offerSources = [
		...new Set(
			[...offers.values()]
				.flatMap((o) => [o.price?.provenance.source, o.availability.provenance.source])
				.filter((s): s is NonNullable<typeof s> => !!s)
		)
	];
	const lookup: LookupView = {
		items,
		...(now ? { days: deliveryDays(cands, d.today, now, d.kitchen.deliveryDays, 10) } : {}),
		searchCalls,
		quotedIds: [...offers.keys()],
		offerSources,
		sanity: sanityWarnings(items, d.kitchen),
		hardLimit: hardLimit(items, d.kitchen)
	};
	return { lookup, picked, cands };
}

export async function idempotencyKeyFor(
	kitchenId: string,
	deliverBy: string,
	lines: unknown,
	nonce = ''
): Promise<string> {
	return `rq-${(await sha256Hex(canonicalJson({ kitchenId, deliverBy, lines, nonce }))).slice(0, 20)}`;
}

const ACTOR_WORDS: Record<string, string> = {
	chef: 'the chef',
	approver: 'the head chef',
	kitchen_agent: 'the kitchen agent',
	external_agent: 'an outside agent',
	system: 'the system',
	job: 'a scheduled job'
};

/** Who did it, in words: "the head chef" for the page's approver, never a raw actor id. */
export function actorName(a: { kind: string; id: string }): string {
	if (a.id === 'head-chef') return 'the head chef';
	if (a.id === 'request-agent') return 'the kitchen agent';
	return ACTOR_WORDS[a.kind] ?? a.kind.replace(/_/g, ' ');
}

/** get_plan's plan and approval, with the approval's total and who asked and decided. */
export async function approvalView(
	handlers: ToolHandlers,
	ctx: CallContext,
	planId: string
): Promise<{ plan: ToolOutput<'get_plan'>['plan']; approval: ApprovalView | null }> {
	const g = await callTool(handlers, ctx, 'get_plan', { planId });
	const a = g.approval;
	if (!a) return { plan: g.plan, approval: null };
	const who = (x?: { kind: string; id: string }) => (x ? actorName(x) : undefined);
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
			mandateVersion: a.mandateVersion ?? null,
			expiresAt: a.expiresAt ?? null,
			requestedBy: who(a.requestedBy) ?? null,
			decidedBy: who(a.decidedBy) ?? null
		}
	};
}

/** The chef's inline answers replace what the words left open; each one is recorded on the item. */
export function applyAnswers(parsed: ParsedRequest, answers: RequestAnswer[]): ParsedRequest {
	if (!answers.length) return parsed;
	const items = parsed.items.map((it) => {
		const a = answers.find((x) => x.item === it.id);
		if (!a) return it;
		const next = { ...it, ambiguities: [...it.ambiguities] };
		if (a.qty !== undefined && a.unit) {
			// An answered amount replaces the words' one; an unknown unit token stays to say what was answered.
			next.qty = a.qty;
			next.unit = a.unit;
			next.amount = { kind: 'exact' };
			next.ambiguities = next.ambiguities.filter((x) => !/^no (quantity|unit) given/.test(x));
		}
		return next;
	});
	return { ...parsed, items, answered: answers };
}

export { requirementsOf };

/**
 * One place_order line. A physical amount the chef typed ("2 l", "4 kg") travels as `amount`, so the plan holds a
 * direct need and a substitute is sized to it, as when the agent orders; the quantity is the server's own sizing of
 * that amount. Cases, packs and pieces the catalogue can't size go as the sales quantity alone.
 */
export function orderLine(
	i: LookupItemView,
	product: Product
): {
	productId: string;
	qty: number;
	unit: string;
	amount?: Measure;
	requirements?: NeedRequirements;
	ask?: NeedAsk;
} {
	const base = {
		productId: i.pick!.productId,
		qty: (i.pick!.conversion as { salesQty: number }).salesQty,
		unit: i.pick!.salesUnit
	};
	const { qty, unit } = i.item;
	const requirements = requirementsOf(i.item.constraints, i.item.diet);
	// A physical ask (kg, l, pcs) is the need's amount as typed. Packs and cases become one through what the picked
	// product states one sales unit holds (never invented): the need then carries the requirements too.
	const amount: Measure | null =
		qty === null
			? null
			: unit === 'kg' || unit === 'l' || unit === 'pcs'
				? { value: qty, unit }
				: i.pick!.amount
					? { value: i.pick!.amount.value, unit: i.pick!.amount.unit }
					: null;
	const sized = amount ? sizeDirect(product, amount) : null;
	// D18: the ask as stated travels on every line; without a physical size the line makes a sales-kind need that
	// still carries the ask and the requirements.
	const ask: NeedAsk | undefined =
		qty === null || unit === null ? undefined : { words: i.item.text, qty, unit: ASK_UNIT[unit] };
	return amount && sized
		? {
				...base,
				qty: sized.value,
				unit: sized.unit,
				amount,
				...(requirements ? { requirements } : {}),
				...(ask ? { ask } : {})
			}
		: { ...base, ...(requirements ? { requirements } : {}), ...(ask ? { ask } : {}) };
}

/** The request's units in the ask's words: packs and an unstated unit are the product's own sales units. */
const ASK_UNIT: Record<string, NeedAsk['unit']> = {
	kg: 'kg',
	l: 'l',
	pcs: 'pcs',
	case: 'case',
	sales: 'pack'
};

/** The chef's chosen delivery date over the words' one, said in the request's notes; a past or bad date is ignored. */
export function withDate(
	parsed: ParsedRequest,
	chosen: string | undefined,
	today: string
): ParsedRequest {
	if (
		!chosen ||
		!/^\d{4}-\d{2}-\d{2}$/.test(chosen) ||
		chosen < today ||
		chosen === parsed.deliverBy
	)
		return parsed;
	return {
		...parsed,
		deliverBy: chosen,
		deliverByChosen: true,
		ambiguities: parsed.ambiguities.filter((a) => !a.startsWith('no delivery date given')),
		notes: [
			...parsed.notes,
			`delivery ${day(chosen)}: your choice; the request said ${day(parsed.deliverBy)}`
		]
	};
}

/**
 * The chef's in-place edit of the reading: the items as edited, the words' date and notes kept from the rules (no
 * model call), ids rebuilt so answers stay keyed. Edited items carry no parse doubts of their own.
 */
function edited(text: string, d: RequestDeps): ParsedRequest {
	const rules = parseRules(text, d.today);
	return {
		...rules,
		items: d.items!.map((it) => ({
			...it,
			ambiguities: it.ambiguities.filter((a) => !/^no (unit|quantity) given/.test(a))
		})),
		ambiguities: rules.ambiguities.filter((a) => !a.startsWith('no item found')),
		notes: [...rules.notes, 'your edit: the words were not read again'],
		parser: { kind: 'rules', model: 'your edit', latencyMs: 0 }
	};
}

/** How unsure a reading is: the reading check's verdict, the model's own doubts, and amounts it could not read. */
async function doubt(text: string, r: ParsedRequest): Promise<number> {
	const v = await reviewReading(text, readingOf(r));
	return (
		(v.kind === 'block' ? 4 : v.kind === 'revise' ? 2 : 0) +
		r.ambiguities.filter((a) => a.startsWith('model:')).length +
		r.items.filter((i) => (i.amount?.kind ?? 'unknown') === 'unknown' && i.qty === null).length +
		(r.parser.fallback ? 2 : 0)
	);
}

/**
 * The D12 cascade: the first model's reading, when unsure, is read once more by the stronger escalate model; the
 * surer reading is kept (the escalated one on a tie) and the step says which model answered. Rules-only readings
 * (no model) are never escalated.
 */
async function escalated(
	text: string,
	first: ParsedRequest,
	d: RequestDeps
): Promise<ParsedRequest> {
	if (first.parser.kind === 'rules' && !first.parser.fallback) return first;
	const before = await doubt(text, first);
	if (before === 0) return first;
	const second = await parseRequest(text, { today: d.today, llm: d.escalate, llmKind: d.llmKind });
	if (second.parser.kind === 'rules') return first;
	const after = await doubt(text, second);
	return after <= before
		? { ...second, parser: { ...second.parser, escalatedFrom: first.parser.model } }
		: first;
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

	const parse = (feedback?: string) =>
		parseRequest(text, { today: d.today, llm: d.llm, llmKind: d.llmKind, feedback });
	let read: ParsedRequest;
	let reviewBlock: string | null = null;
	if (d.review) {
		// The parse checkpoint: on revise the parser runs once more with the critique; what is still
		// wrong is shown as an ambiguity; a block stops before any catalogue call.
		const r = await withReview(
			requestParseCheckpoint,
			{ input: { text }, facts: null, produce: parse },
			d.review
		);
		read = r.output;
		if (r.verdict.kind === 'revise')
			read = { ...read, ambiguities: [...read.ambiguities, `review: ${r.verdict.feedback}`] };
		if (r.verdict.kind === 'block') reviewBlock = r.verdict.reason;
	} else read = d.items?.length ? edited(text, d) : await parse();
	if (!d.items?.length && d.escalate) read = await escalated(text, read, d);
	let parsed = withDate(applyAnswers(read, d.answers ?? []), d.deliverBy, d.today);
	// A question or a change to something open is not an order: nothing is searched or placed (D20).
	if (parsed.intent === 'question' || parsed.intent === 'change') {
		emit({ step: 'request', status: 'blocked', ms: ms(), data: parsed as ParsedView });
		return {
			parsed: parsed as ParsedView,
			lookup: null,
			order: null,
			message:
				parsed.intent === 'question'
					? 'This reads as a question, not an order: nothing was searched or ordered. Ask it in the chat.'
					: 'This reads as a change to an order already made: nothing new was ordered. Change it on the plan in the Kitchen.'
		};
	}
	// A dish with a count is portions to serve: priced ready-made and from raw, and the kitchen's way is ordered.
	let dish: DishInterpretation | null = null;
	let readingBlock: string | null = null;
	if (!d.dish?.packs && !d.items?.length && !reviewBlock) {
		// The words, or the reading's dish item (what: dish, for N people) when the words name no count we read.
		const modelDish = parsed.items.find(
			(i) => i.what === 'dish' && i.amount?.kind === 'for_people'
		);
		const base =
			modelDish && modelDish.amount?.kind === 'for_people'
				? `${modelDish.amount.n} portions ${modelDish.query} ${text}`
				: text;
		const words = d.dish?.portions
			? base.replace(/\d{1,3}(?:[ ,]\d{3})+|\d+(?:[.,]\d+)?/, String(d.dish.portions))
			: base;
		dish = await interpretDish(words, {
			handlers: d.handlers,
			ctx: d.ctx,
			deliverBy: parsed.deliverBy,
			kitchen: d.kitchen,
			now: nowOf(d)
		});
	}
	if (dish && dish.ask && !d.dish) {
		const view = { ...parsed, items: [], dish, ambiguities: [] } as ParsedView;
		emit({ step: 'request', status: 'blocked', ms: ms(), data: view });
		return { parsed: view, lookup: null, order: null, message: dish.ask.question };
	}
	let dishAnswers: RequestAnswer[] = [];
	if (dish) {
		const kind = d.dish?.option ?? dish.preferred.kind;
		const { items, answers, left } = dishItems(dish, kind);
		dishAnswers = answers;
		parsed = {
			...parsed,
			items,
			// The dish reading replaces the item guesses ("unclear", "no unit"): its reasoning is shown instead.
			ambiguities: parsed.ambiguities.filter(
				(a) => !a.startsWith('model:') && !a.startsWith('the model found')
			),
			notes: [...parsed.notes, ...left.map((l) => `left out: ${l}`)],
			dish,
			dishChoice: kind
		};
	}
	// The reading is judged against the words on every request: a block is the question, asked before any lookup.
	if (!dish && !d.items?.length && !reviewBlock) {
		const v = await reviewReading(text, readingOf(parsed), d.review ?? {});
		if (v.kind === 'block') readingBlock = v.reason;
		else if (v.kind === 'revise')
			parsed = { ...parsed, ambiguities: [...parsed.ambiguities, `check: ${v.feedback}`] };
	}
	let parsedView = parsed as ParsedView;
	if (readingBlock) {
		emit({ step: 'request', status: 'blocked', ms: ms(), data: parsedView });
		return { parsed: parsedView, lookup: null, order: null, message: readingBlock };
	}
	if (reviewBlock) {
		emit({ step: 'request', status: 'blocked', ms: ms(), data: parsedView });
		return {
			parsed: parsedView,
			lookup: null,
			order: null,
			message: `The reading of this request did not pass review: ${reviewBlock}`
		};
	}

	// An event brief is never a catalogue query: say what it is, and where a seeded plan lives.
	const brief = dish ? null : classifyRequest(text, parsed.items, d.kitchen.id);
	if (brief) {
		const draft = applyBriefAnswers(draftBrief(text, d.today), d.briefAnswers ?? [], d.today);
		const question = nextQuestion(draft, d.today);
		const event: EventView = {
			...brief,
			deliverBy: parsed.deliverBy,
			deliverByText: parsed.deliverByText,
			draft,
			question
		};
		emit({ step: 'request', status: 'blocked', ms: ms(), data: parsedView });
		return {
			parsed: parsedView,
			lookup: null,
			order: null,
			event,
			message: question
				? `This is an event to plan, not products to buy: nothing was searched or ordered. ${question.text}`
				: 'The brief is complete. A menu proposal from it is next; nothing was searched or ordered.'
		};
	}

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

	const lookupDeps = dishAnswers.length
		? { ...d, answers: [...(d.answers ?? []), ...dishAnswers] }
		: d;
	let { lookup, picked, cands } = await lookupItems(parsed, lookupDeps);
	// No day in the words: the default is the earliest day open for every item, never a passed one. Said, not silent.
	const now = nowOf(d);
	if (parsed.deliverBySource === 'default' && !parsed.deliverByChosen && now) {
		const here = lookup.days?.find((x) => x.date === parsed.deliverBy);
		const first = lookup.days?.find((x) => x.open && x.receiving);
		if (here && !here.open && first) {
			parsed = {
				...parsed,
				deliverBy: first.date,
				ambiguities: parsed.ambiguities.filter((a) => !a.startsWith('no delivery date given')),
				notes: [...parsed.notes, `no day given: earliest you can get, ${day(first.date)}`]
			};
			parsedView = parsed as ParsedView;
			emit({
				step: 'request',
				status:
					parsed.ambiguities.length || parsed.items.some((i) => i.ambiguities.length)
						? 'warn'
						: 'done',
				ms: 0,
				data: parsedView
			});
			({ lookup, picked, cands } = await lookupItems(parsed, lookupDeps));
		}
	}
	const picks = lookup.items.filter((i) => i.pick);
	// An item without a pick holds the whole order: placing the rest now and the answered item
	// later would place the rest twice (the answer changes the lines, so the key).
	// A dish is all its lines or nothing: pasta without the mince serves no one.
	const dishLeft = dish ? parsed.notes.filter((n) => n.startsWith('left out: ')) : [];
	const unplaced = lookup.items
		.filter((i) => !i.pick)
		.map((i) => ({ id: i.item.id, query: i.item.query, reason: i.question ?? 'nothing to pick' }));
	emit({
		step: 'lookup',
		status:
			unplaced.length || dishLeft.length || (lookup.sanity.length && !d.confirmLarge)
				? 'blocked'
				: lookup.sanity.length ||
					  picks.some((i) => i.pick?.conversion?.ok && i.pick.conversion.warnings.length)
					? 'warn'
					: 'done',
		ms: ms(),
		data: lookup
	});
	if (picks.length === 0)
		return {
			parsed: parsedView,
			lookup,
			order: null,
			unplaced,
			// A passed cut-off is the whole answer: say it, with the date still open.
			message: lookup.items.every((i) => i.answer?.kind === 'date')
				? `${lookup.items[0].question} Nothing was ordered; choose that date to order.`
				: 'Nothing to order yet: answer the questions above.'
		};
	// The chosen lines, echoed against the ask: more than one pack over what was asked is never placed.
	const echo = await reviewReading(
		text,
		{
			items: [],
			echo: lookup.items.flatMap((i) => {
				const p = i.pick;
				const u = i.item.unit;
				if (!p?.conversion?.ok || !p.amount || i.item.qty === null || (u !== 'kg' && u !== 'l'))
					return [];
				// The chef took an order far over the ask knowingly: not asked again.
				if (d.answers?.some((x) => x.item === i.item.id && x.acceptRounding)) return [];
				return [
					{
						item: i.item.id,
						asked: { value: i.item.qty, unit: u },
						salesQty: p.conversion.salesQty,
						salesUnit: p.salesUnit,
						perUnit:
							p.amount.unit === u
								? { value: p.amount.value / p.conversion.salesQty, unit: u }
								: null
					}
				];
			})
		},
		{}
	);
	if (echo.kind === 'block' && d.place !== false)
		return { parsed: parsedView, lookup, order: null, message: echo.reason };
	if (dish && dishLeft.length && d.place !== false)
		return {
			parsed: parsedView,
			lookup,
			order: null,
			unplaced: dishLeft.map((n) => ({ id: n, query: n.slice(10), reason: 'no product' })),
			message: `Nothing placed: ${dishLeft.length} of the dish's lines ${dishLeft.length === 1 ? 'has' : 'have'} no product (${dishLeft.map((n) => n.slice(10).split(':')[0]).join(', ')}). Switch the way to serve it, or change the request.`
		};
	if (unplaced.length && d.place !== false)
		return {
			parsed: parsedView,
			lookup,
			order: null,
			unplaced,
			message: `Nothing placed yet: ${unplaced.map((u) => u.query).join(', ')} still ${unplaced.length === 1 ? 'needs' : 'need'} an answer. Answer above, or take ${unplaced.length === 1 ? 'it' : 'them'} out of the request to order the other ${picks.length}.`
		};
	if (lookup.sanity.length && !d.confirmLarge && d.place !== false)
		return {
			parsed: parsedView,
			lookup,
			order: null,
			needsConfirm: true,
			message: 'This order is far larger than this kitchen usually needs. Nothing was placed.'
		};
	if (d.place === false)
		return { parsed: parsedView, lookup, order: null, message: 'Lookup only (place=false).' };

	const lines = picks.map((i) => orderLine(i, picked.get(i.item.id)!));
	const pickedCands = lookup.items.map((it, k) =>
		cands[k].filter((c) => !it.pick || c.product.productId === it.pick.productId)
	);
	const idempotencyKey = await idempotencyKeyFor(d.kitchen.id, parsed.deliverBy, lines, d.nonce);
	try {
		const placed = await callTool(d.handlers, d.ctx, 'place_order', {
			kitchenId: d.kitchen.id,
			deliverBy: parsed.deliverBy,
			idempotencyKey,
			lines
		});
		const { plan, approval } = await approvalView(d.handlers, d.ctx, placed.plan.id);
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
				hardLimitCents: hardLimitCents(d.kitchen.mandate),
				mandateVersion: d.kitchen.mandate.version,
				deliveryDays: [...d.kitchen.deliveryDays]
			},
			deliveryNote: d.kitchen.deliveryDays.includes(dow)
				? null
				: `${d.kitchen.name} takes deliveries on ${d.kitchen.deliveryDays.map(cap).join(', ')}; ${day(parsed.deliverBy)} is not one of them`,
			// The next receiving day that is still open for what was picked: the day the button names is the day it gives.
			nextDeliveryDay: d.kitchen.deliveryDays.includes(dow)
				? null
				: nextOpenReceivingDay(parsed.deliverBy, d.kitchen.deliveryDays, pickedCands, nowOf(d)),
			task: await taskForPlan({
				tasks: d.tasks,
				ctx: d.ctx,
				now: nowOf(d),
				plan,
				title: text,
				requirement: {
					kind: 'order',
					text,
					deliverBy: parsed.deliverBy,
					items: parsed.items.map((i) => ({
						query: i.query,
						qty: i.qty,
						unit: i.unit,
						constraints: i.constraints
					}))
				},
				approval: approval?.state === 'pending' ? approval : null
			})
		};
		const held = plan.lines.some((l) => l.state === 'held');
		const nothingOrderable = plan.lines.every(
			(l) => l.state === 'unorderable' || l.state === 'rejected'
		);
		emit({
			step: 'order',
			status: nothingOrderable ? 'error' : held || order.deliveryNote ? 'warn' : 'done',
			ms: ms(),
			data: order
		});
		return {
			parsed: parsedView,
			lookup,
			order,
			message: 'This plan is now in your Kitchen; nothing is placed until it is committed.'
		};
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		emit({ step: 'order', status: 'error', ms: ms(), data: null, message });
		return { parsed: parsedView, lookup, order: null, message };
	}
}
