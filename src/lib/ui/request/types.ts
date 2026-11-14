/**
 * What the request flow returns, step by step: Request → Lookup → Order → Approval. Shared by the
 * server orchestration, the JSON endpoint and the /request page (types only, no server code; the answer and unit types live in server/request).
 */
import type { Offer, Plan, Tier } from '$lib/core/contracts';

import type { ReqUnit } from '$lib/server/request/lexicon';
import type { RequestAnswer } from '$lib/server/request/workspace';

// The server owns the request's own vocabulary; the page sees the same types (type-only, erased in the build).
export type { ReqUnit, RequestAnswer };

export interface ParsedItemView {
	/** Stable item id; answers are keyed by it. */
	id: string;
	text: string;
	query: string;
	product: string | null;
	search: string[];
	qty: number | null;
	unit: ReqUnit | null;
	constraints: string[];
	variant: { token: string; label: string; search?: string } | null;
	ambiguities: string[];
}

/** How a question can be answered inline. */
export type AnswerSpec =
	| { kind: 'qty'; item: string; units: ReqUnit[]; salesUnit?: string }
	| {
			kind: 'choice';
			item: string;
			options: { label: string; detail: string; answer: RequestAnswer }[];
			/** Also offer "give the amount instead" in these units. */
			alsoQty?: { units: ReqUnit[] };
	  }
	/** Ordering for the date has closed: one click re-runs the request for the first date still open. */
	| { kind: 'date'; item: string; date: string; label: string };

export interface ParsedView {
	text: string;
	items: ParsedItemView[];
	deliverBy: string;
	deliverByText: string | null;
	deliverBySource: 'request' | 'default';
	notes: string[];
	ambiguities: string[];
	/** Inline answers applied on top of the words. */
	answered?: RequestAnswer[];
	parser: {
		kind: 'rules' | 'gemini' | 'featherless' | 'fixture';
		model: string;
		latencyMs: number;
		tokens?: { in: number; out: number };
		fallback?: string;
	};
}

export interface CandidateView {
	productId: string;
	name: string;
	score: number;
	reasons: string[];
	salesUnit: string;
	/** Conversion of the request quantity, or why it could not be done. */
	conversion:
		| { ok: true; salesQty: number; explain: string; exact: boolean; warnings: string[] }
		| { ok: false; reason: string }
		| null;
	offer: Offer | null;
	/** Why it was passed over after quoting; null for the pick and unquoted ones. */
	skipped: string | null;
	picked: boolean;
	quoted: boolean;
	/** What the converted quantity holds in total, when the product states it. */
	amount?: { value: number; unit: 'kg' | 'l' } | null;
}

export interface ValioRuleView {
	from: string;
	to: string;
	toName: string | null;
	status: 'skipped' | 'available' | 'not_quoted';
	reason: string;
}

export interface LookupItemView {
	item: ParsedItemView;
	searches: { query: string; hits: number }[];
	shortlist: CandidateView[];
	rejected: { productId: string; name: string; reason: string }[];
	rejectedCount: number;
	pick: CandidateView | null;
	/** Set when nothing could be picked: the question for the chef. */
	question: string | null;
	answer: AnswerSpec | null;
	valioRules: ValioRuleView[];
	/** Under a Rank by preference: what it picked instead of the kitchen default, and why, in one line. */
	rankNote?: string;
}

export interface LookupView {
	items: LookupItemView[];
	searchCalls: number;
	quotedIds: string[];
	/** Where the offers came from (valio_live / valio_cache / simulator). */
	offerSources: string[];
	/** Size checks against the kitchen's own numbers; non-empty means confirm before placing. */
	sanity: string[];
	/** Set when the order is over the mandate's hard limit: placing it gives an unorderable line. */
	hardLimit: { totalCents: number; limitCents: number } | null;
}

export interface ApprovalView {
	id: string;
	state: string;
	tier: Tier;
	planVersion: number;
	termsHash: string;
	lineIds: string[];
	totalCents: number;
	mandateVersion: number | null;
	expiresAt: string | null;
	requestedBy: string | null;
	decidedBy: string | null;
}

export interface OrderView {
	idempotencyKey: string;
	plan: Plan;
	approval: ApprovalView | null;
	/** True when place_order returned a stored plan for the same key. */
	replayed: boolean;
	kitchen: {
		id: string;
		name: string;
		mandateWords: string;
		lineCapCents: number;
		orderCapCents: number;
		weeklyCapCents: number;
		hardLimitCents: number;
		mandateVersion: number;
		/** Receiving days (mon…sun), for an off-delivery-day hold. */
		deliveryDays?: string[];
	};
	deliveryNote: string | null;
	/** The kitchen's next receiving day after an off-day date, offered as a one-tap change. */
	nextDeliveryDay?: string | null;
	/** The procurement task this order belongs to (null id: no task store yet) and the plan in the Kitchen. */
	task: TaskLink;
}

export interface CommitView {
	orderId: string;
	receiptId: string;
	totalCents: number;
	committedLineIds: string[];
	awaitingSupplier: string[];
	idempotencyKey: string;
	/** The plan version this commit was for; a retry sends it again to get the same receipt. */
	version: number;
	attempt: number;
}

export type StepStatus = 'done' | 'warn' | 'blocked' | 'error';

export type RequestEvent =
	| { step: 'request'; status: StepStatus; ms: number; data: ParsedView }
	| { step: 'lookup'; status: StepStatus; ms: number; data: LookupView }
	| { step: 'order'; status: StepStatus; ms: number; data: OrderView | null; message?: string }
	| { step: 'error'; status: 'error'; ms: number; message: string };

export interface RequestResult {
	parsed: ParsedView;
	lookup: LookupView | null;
	order: OrderView | null;
	message?: string;
	/** Set when the order is unusually large and was not placed: send again with confirmLarge. */
	needsConfirm?: boolean;
	/** Items still without a pick, and why; while any is listed nothing is placed. */
	unplaced?: { id: string; query: string; reason: string }[];
	/** Set when the words are an event to plan, not products to buy: nothing was searched. */
	event?: EventView;
}

/** An open event brief: planning it from a menu is not built yet; a seeded event may match. */
export interface EventView {
	guests: number | null;
	courses: number | null;
	occasion: string;
	deliverBy: string;
	deliverByText: string | null;
	seeded: { eventId: string; title: string } | null;
	/** What the brief holds so far (words and answers). */
	draft?: BriefDraft;
	/** The one thing still missing, asked next; null when the brief is complete. */
	question?: BriefQuestion | null;
}

export type ServiceStyleWord = 'buffet' | 'plated' | 'family' | 'canape' | 'lunch';
export type BriefField = 'guests' | 'date' | 'serviceStyle' | 'courses' | 'dietary' | 'budget';

/**
 * An event brief while it is being completed. `null` = not known yet (ask); for dietary and budget an explicit
 * "none" is `[]` / `0`, so "not asked" and "asked, nothing" stay distinct.
 */
export interface BriefDraft {
	title: string;
	guests: number | null;
	date: string | null;
	dateText: string | null;
	serviceStyle: ServiceStyleWord | null;
	courses: number | null;
	/** Normalised requirements ("lactose-free", "vegetarian:6"); typed ones are never dropped. */
	dietary: string[] | null;
	/** Food budget ex VAT for the whole event; 0 = no budget given on purpose. */
	budgetCents: number | null;
	/** Where each known field came from: the request words or the chef's answer. */
	from: Partial<Record<BriefField, 'words' | 'answer'>>;
	notes: string[];
}

/** An answer to a brief question, keyed by the question's stable id ("brief.guests"). */
export interface BriefAnswer {
	id: `brief.${BriefField}`;
	value: string | number | string[];
}

/** One focused question with ready answers as chips, and optionally a typed value. */
export interface BriefQuestion {
	id: `brief.${BriefField}`;
	field: BriefField;
	text: string;
	/** Why it matters for the menu, in one line. */
	why: string;
	chips: { label: string; answer: BriefAnswer }[];
	input?: { kind: 'number' | 'date' | 'text'; placeholder: string; unit?: string };
	/** Chips may be combined (dietary): the page sends the chosen values together. */
	multi?: boolean;
}

export type { MenuChange, MenuPlanResult, MenuView } from '$lib/server/menu/flow';
import type { TaskLink } from '$lib/server/request/task';
export type { TaskLink };
