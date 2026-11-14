// Scenario files (evals/scenarios/*.json) and the end state a gate adapter reports after playing them.
// Plain types on purpose: the runner stays independent of src/lib/core until an adapter maps core state onto EndState.

export type Actor = 'chef' | 'kitchen_agent' | 'external_agent' | 'approver' | 'system';

export type Action =
	| 'request'
	| 'plan_event'
	| 'edit_line'
	| 'search'
	| 'quote'
	| 'place_order'
	| 'approve'
	| 'commit'
	| 'set_price'
	| 'set_availability'
	| 'find_substitutes'
	| 'recall'
	| 'reset'
	| 'set_clock';

export interface Step {
	actor: Actor;
	action: Action;
	input: Record<string, unknown>;
	comment?: string;
}

export interface Scenario {
	id: string;
	title: string;
	stories: string[];
	edgeCases: number[];
	seeds: { kitchen: string; event?: string };
	clock: string;
	state?: { weekSpentCents?: number; priorOrders?: unknown[] };
	overrides?: { availability?: unknown[]; price?: unknown[] };
	steps: Step[];
	expect: Record<string, unknown>;
	/**
	 * Known gaps, keyed by SYNTHESIS finding id (e.g. "F5"): result keys (or key prefixes) that must still fail.
	 * Every other key must pass. When a listed key starts passing the eval goes red: the fix landed, so delete
	 * the entry. Lanes fixing a finding may edit only this field.
	 */
	expectFail?: Record<string, string[]>;
	notes?: string;
}

/** A line or candidate as the gate shows it at the end of the scenario. */
export interface LineView {
	productId: string;
	qty?: number;
	unit?: string;
	needKg?: number;
	state: string; // proposed | eligible | held | rejected | unorderable | committed
	tier?: string; // act | propose | sign_off
	reasons: string[];
	priceCents?: number;
	lineCents?: number;
	deliveryDate?: string;
	historyStates?: string[];
	historyReasons?: string[];
	/** True when the line can be picked as an option in the UI. */
	pickable?: boolean;
	/** Shown labels (e.g. "simulated: …"). */
	labels?: string[];
	/** The product this line replaces (a rescue). */
	substituteFor?: string;
	/** Order cut-off for this line (offer availability closingTime, scenario dates). */
	closingTime?: string;
}

export interface AttemptOutcome {
	step: number;
	action: Action;
	actor: Actor;
	idempotencyKey?: string;
	productId?: string;
	result: 'ok' | 'receipt' | 'error';
	error?: string;
	retryable?: boolean;
	receiptId?: string;
	/** find_substitutes: whether the call changed the plan, and the recommended products. */
	applied?: boolean;
	chosen?: string[];
	/** find_substitutes: product, make_in_house or none. */
	kind?: string;
	/** quote: the cut-off of every offer returned. */
	closingTimes?: string[];
}

export interface PlanView {
	key: string;
	totalCents: number;
	state: string;
	states: string[];
	tier?: string;
	reasons: string[];
}

export interface EndState {
	lines: LineView[];
	/** Lines after the last edit, when a scenario edits (s2). Defaults to `lines`. */
	linesAfterEdit?: LineView[];
	plans: PlanView[];
	attempts: AttemptOutcome[];
	receipts: { id: string; idempotencyKey?: string }[];
	approvalStates: string[];
	weekSpentCents: number;
	residualShortfall: Record<string, unknown>[];
	unconfirmedCover: string[];
	availabilityKinds: Record<string, string>;
	ranking: Record<string, string[]>; // need → productIds in rank order
	ops: { op: string; actor: string; approvalState?: string }[];
	valioCallIds: string[];
	why: Record<string, string[]>; // productId → steps shown
	externalAgentTools: string[];
	/** UI wording per availability kind, e.g. { out: "Out of stock", undeliverable: "Not deliverable" }. */
	wording: Record<string, string>;
	recomputeMs?: number;
	/** The newest plan's current approval (get_plan), as product ids; null when none is open. */
	approval?: { state: string; productIds: string[] } | null;
	/** Committed order lines with who allowed each: the mandate, an approval, or unrecorded (F8). */
	orderLines?: { productId: string; authority: 'mandate' | 'approval' | 'unrecorded' }[];
	/** Ops left in runs before the last reset (kept for audit). */
	previousRunOps?: number;
}

export interface CheckResult {
	key: string;
	pass: boolean;
	detail: string;
}
