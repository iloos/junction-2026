/**
 * What the request flow returns, step by step: Request → Lookup → Order → Approval. Shared by the
 * server orchestration, the JSON endpoint and the /request page (types only, no server code).
 */
import type { Offer, Plan, Tier } from '$lib/core/contracts';

export type ReqUnit = 'l' | 'kg' | 'pcs' | 'case' | 'sales';

export interface ParsedItemView {
	text: string;
	query: string;
	product: string | null;
	search: string[];
	qty: number | null;
	unit: ReqUnit | null;
	constraints: string[];
	variant: { token: string; label: string } | null;
	ambiguities: string[];
}

export interface ParsedView {
	text: string;
	items: ParsedItemView[];
	deliverBy: string;
	deliverByText: string | null;
	deliverBySource: 'request' | 'default';
	notes: string[];
	ambiguities: string[];
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
	valioRules: ValioRuleView[];
}

export interface LookupView {
	items: LookupItemView[];
	searchCalls: number;
	quotedIds: string[];
	/** Where the offers came from (valio_live / valio_cache / simulator). */
	offerSources: string[];
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
		mandateVersion: number;
	};
	deliveryNote: string | null;
}

export interface CommitView {
	orderId: string;
	receiptId: string;
	totalCents: number;
	committedLineIds: string[];
	awaitingSupplier: string[];
	idempotencyKey: string;
	attempt: number;
}

export type StepKey = 'request' | 'lookup' | 'order' | 'approval';
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
}
