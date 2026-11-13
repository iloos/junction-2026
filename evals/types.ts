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
	| 'find_substitutes';

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
}

export interface CheckResult {
	key: string;
	pass: boolean;
	detail: string;
}
