/**
 * Ports: every outside dependency the core needs. Each has a real adapter and a fixture adapter
 * (CLAUDE.md rule 2) under src/lib/server/adapters/<port>/. The core imports only these types.
 */
import type {
	Actor,
	DomainError,
	Kitchen,
	MenuProposal,
	Task,
	Offer,
	OpEnvelope,
	PendingOp,
	PlanOrigin,
	Product,
	ProductId,
	Result,
	ServerEvent,
	SimEvent,
	ToolInput,
	ToolName,
	ToolOutput
} from './contracts';
import type { WorkspaceState } from './state';

/** Simulator clock: owns "now", cut-offs and the December scenario date. */
export interface Clock {
	now(): Date;
}

/**
 * Catalog: static catalogue + live terms. Real = Valio API cache-through (per-product keys, ≤4 concurrent,
 * ≤200 ids per call, backoff + breaker → cache) layered with the simulator; fixture = cached responses only.
 * Unknown ids are rejected before any call (D6).
 */
export interface Catalog {
	get(ids: ProductId[]): Promise<Map<ProductId, Product>>;
	search(query: string, opts?: { limit?: number; foodOnly?: boolean }): Promise<Product[]>;
	/** Live terms with simulator overlays applied; never throws for a provider outage (stale cache + provenance). */
	offers(ids: ProductId[], deliverBy: string): Promise<{ offers: Offer[]; notFound: string[] }>;
	/** Candidate pool for a product: Valio's rules first, then same category/temperature/comparison unit. */
	candidates(
		productId: ProductId,
		limit?: number
	): Promise<{ productId: ProductId; fromValioRule: boolean }[]>;
	/**
	 * Resolve a menu ingredient query to products, or say why nothing qualifies (never the top substring hit).
	 * `diet` flags are hard: a product missing one is `nearest` with that flag as the failure. Optional so fixture
	 * catalogues without it still type-check; the menu module treats a missing resolver as unresolved.
	 */
	resolve?(query: string, opts?: { limit?: number; diet?: string[] }): Promise<Resolution>;
}

export type Resolution =
	| { status: 'resolved'; query: string; candidates: { productId: ProductId; score: number }[] }
	| {
			status: 'unresolved';
			query: string;
			/** Our own words: "no product words", "products match X but none is lactose-free", … */
			reason: string;
			/** Closest products and what they failed (`match` = name too far; a diet flag = that property missing). */
			nearest: { productId: ProductId; failed: string }[];
	  };

/** Simulator: stock truth and scenario overlays (contention, split delivery, cut-off). */
export interface Simulator {
	/**
	 * Atomic conditional consume at commit (`… where available >= qty`). Runs inside the store transaction, so it
	 * reads only through `tx`: the caller passes the offer it fetched beforehand, used to seed the stock row.
	 */
	consume(
		tx: Tx,
		productId: ProductId,
		qty: number,
		offer?: Offer
	): Promise<Result<{ lotId: string | null; confirmed: boolean }>>;
	events(sinceSimTime?: string): SimEvent[];
}

/** Gemini Decisions API: calibrated yes/no, choice and rubric scores. Fallbacks: recorded replay → rules. */
export interface Decide {
	yesNo(q: { question: string; context: string }): Promise<Decision<boolean>>;
	choice<T extends string>(q: {
		question: string;
		options: readonly T[];
		context: string;
	}): Promise<Decision<T>>;
	/** Rubric score, e.g. recipe fit 0–4. */
	score(q: {
		question: string;
		rubric: string;
		context: string;
		max: number;
	}): Promise<Decision<number>>;
	/**
	 * Many questions in one call (Gemini Decisions answers ~120 in one request). Ids are the caller's; answers come
	 * back keyed by id. A fixture/replay/rules fallback answers per question. Optional until the adapter has it.
	 */
	batch?(qs: DecideQuestion[]): Promise<Record<string, Decision<boolean | string | number>>>;
}
export type DecideQuestion =
	| { id: string; kind: 'yes_no'; question: string; context: string }
	| { id: string; kind: 'choice'; question: string; options: readonly string[]; context: string }
	| { id: string; kind: 'score'; question: string; rubric: string; context: string; max: number };
export interface Decision<T> {
	value: T;
	confidence: number;
	/** Calibrated probability of "yes" for a yes/no question. Shown, never used to grant anything. */
	p?: number;
	/** Probability per option for a choice or score question. */
	probabilities?: Record<string, number>;
	source: 'gemini' | 'replay' | 'rules';
	model?: string;
	latencyMs: number;
}

/** Free-text / tool-calling model (Gemini flash-lite, Gemma via Featherless/Verda). Every call is traced. */
export interface Llm {
	generate(req: {
		system?: string;
		prompt: string;
		maxTokens: number;
		json?: boolean;
		/** Pictures sent with the prompt (vision models only; text-only adapters ignore them). */
		images?: { mimeType: string; base64: string }[];
		/** Cancels the provider call when the run stops (an in-flight call may still be billed). */
		signal?: AbortSignal;
	}): Promise<{
		text: string;
		model: string;
		tokens: { in: number; out: number };
		latencyMs: number;
	}>;
}

/** Web discovery (Exa, Context.dev): Ring 1. */
export interface Web {
	search(
		query: string,
		opts?: { limit?: number }
	): Promise<{ url: string; title: string; text?: string }[]>;
}

/** Opaque transaction handle; the store adapter knows what it is. */
export type Tx = { readonly __tx: unique symbol };

/**
 * Store: persists state + ops in one transaction. `transact` locks the workspace (event sequence + budget rows)
 * for its duration; never hold it across a model or API call (D6).
 */
export interface Store {
	transact<T>(
		workspaceId: string,
		fn: (
			tx: Tx,
			state: WorkspaceState
		) => Promise<{ ops: PendingOp[]; value: T } | { error: DomainError }>
	): Promise<Result<{ value: T; ops: OpEnvelope[] }>>;
	load(workspaceId: string, runId: string): Promise<WorkspaceState>;
	kitchens(workspaceId: string): Promise<Kitchen[]>;
	/** Add a kitchen to the workspace (create_kitchen). Absent: kitchens are seeded only. */
	addKitchen?(workspaceId: string, kitchen: Kitchen): Promise<void>;
	/** Idempotency: unique per (workspace, caller, key) with a request hash. */
	idempotency(
		tx: Tx,
		k: { workspaceId: string; caller: string; tool: string; key: string; requestHash: string }
	): Promise<{ status: 'new' } | { status: 'replay'; response: unknown } | { status: 'conflict' }>;
	rememberResponse(
		tx: Tx,
		k: { workspaceId: string; caller: string; tool: string; key: string },
		response: unknown
	): Promise<void>;
	/** Locked weekly budget row: returns spent cents for the kitchen/week under the transaction's lock. */
	lockBudget(tx: Tx, k: { workspaceId: string; kitchenId: string; week: string }): Promise<number>;
	addSpend(
		tx: Tx,
		k: { workspaceId: string; kitchenId: string; week: string },
		cents: number
	): Promise<void>;
}

/** Op log reads and live subscription (Postgres NOTIFY → SSE; in-memory for the fixture). */
export interface Ops {
	readAfter(workspaceId: string, seq: number, limit?: number): Promise<OpEnvelope[]>;
	subscribe(workspaceId: string, onEvent: (e: ServerEvent) => void): () => void;
}

/** Per-call context, derived server-side from the credential (D6). */
export interface CallContext {
	workspaceId: string;
	runId: string;
	actor: Actor;
	scopes: readonly string[];
	via: string;
	/** The principal who started an agent run acting under this context (never request-supplied). */
	initiatedBy?: Actor;
	/**
	 * The visitor this call acts for: a hashed id of the browser's own sandbox, set by the server, never from a
	 * request. A kitchen with an `owner` takes writes only from its owner's visitor (D24); absent fails closed.
	 */
	visitor?: string;
	/**
	 * The shared room (ws-judges) as a visitor, not a presenter: writes are allowed only on kitchens this visitor owns,
	 * and the seeded room kitchens are read-only (D24). Set by the server for every context in the room; only a
	 * presenter's Kitchen session clears it.
	 */
	sharedRoom?: boolean;
	/**
	 * D22: a chef's own AI client (a chef key) approves only through an elicitation the person accepted, showing the
	 * exact terms. `elicited` is set by the MCP door after that acceptance, never from a request.
	 */
	approveBy?: 'elicitation';
	elicited?: boolean;
	/** Kitchens this context may act for; absent = every kitchen in the workspace. */
	kitchenIds?: readonly string[];
	/**
	 * Checked by commit_order under the workspace lock, immediately before the order is written: a reason to refuse
	 * (the task this purchase serves was cancelled), or null to go on. It reads through `tx`, the transaction holding the
	 * lock (a read beside it would wait on that lock). Set by the server, never from a request.
	 */
	fence?: (tx: Tx) => Promise<string | null>;
	/** The door this call came through, set by the server; new plans record it (Plan.origin). Never request-supplied. */
	origin?: PlanOrigin;
}

/**
 * Procurement tasks (agent lane owns the adapter on table `agent_tasks`). Writes are compare-and-set on `version`.
 */
export interface TaskStore {
	get(workspaceId: string, id: string): Promise<Task | null>;
	list(
		workspaceId: string,
		opts?: { kitchenId?: string; open?: boolean; limit?: number }
	): Promise<Task[]>;
	put(task: Task, expectedVersion: number | null): Promise<Result<Task>>;
	/** `get` inside a store transaction (a purchase's fence); absent where reads never wait on a lock (in memory). */
	getIn?(tx: Tx, workspaceId: string, id: string): Promise<Task | null>;
}

/**
 * Menu proposals (Track B owns the adapter, `src/lib/server/menu/**`): stored per workspace and revision before any
 * recoverable URL is returned. `review` records who accepted which revision (digest = termsHash-style hash of the
 * canonical proposal); plan_event reads only reviewed revisions.
 */
export interface MenuStore {
	get(workspaceId: string, id: string, revision: number): Promise<MenuProposal | null>;
	latest(workspaceId: string, id: string): Promise<MenuProposal | null>;
	put(workspaceId: string, proposal: MenuProposal): Promise<void>;
	/** The latest revision of this kitchen's most recent proposals, newest first (what the kitchen settled on). */
	recent(workspaceId: string, kitchenId: string, limit: number): Promise<MenuProposal[]>;
	review(
		workspaceId: string,
		id: string,
		revision: number,
		by: Actor,
		at: Date
	): Promise<Result<MenuProposal>>;
}

/**
 * What a web route or web tool runs under (F19): the caller's context, the ports of *that* workspace, and the key its
 * spend is counted against. Web code never falls back to the default workspace's ports.
 */
export interface WebExecutionContext {
	ctx: CallContext;
	ports: Pick<Ports, 'clock' | 'catalog' | 'store' | 'web'>;
	/** Daily Exa/Context.dev spend is counted per this key (the credential id) and globally. */
	spendKey: string;
}

/**
 * Judge keys and visitor sessions (Track G owns the one implementation; E and the routes consume it).
 * Format, stateless HMAC: `jk_<wsId>.<expiresEpochS>.<base64url HMAC-SHA256(JUDGE_KEY_SECRET, "jk|" + wsId + "|" + exp)>`,
 * verified in constant time. A key binds a visitor workspace, the external judge's scopes (read, plan, order: never
 * approve) and an expiry (the event's end); it resolves to that workspace's *current* run, so a reset keeps the key
 * working on the fresh run. The visitor cookie is signed the same way (`vs|` prefix): an unguessable id alone is
 * not authorisation. An approval URL only locates a plan; approving still needs a chef session for that workspace.
 * Disabled, with a clear error, when JUDGE_KEY_SECRET is unset.
 */
export interface JudgeKeys {
	mint(visitorWorkspaceId: string, expiresAt: Date): string | null;
	/** The visitor workspace the key is bound to, or null for an invalid or expired key. */
	verify(key: string, now: Date): string | null;
}

/**
 * The seam between lanes: core-db implements one handler per tool (services), agent serves them as
 * MCP + REST + OpenAPI and uses them in the agent loop, kitchen/ops call them over REST.
 * Handlers check `ctx.scopes` against the tool's scope before doing anything.
 */
export type ToolHandlers = {
	[N in ToolName]: (ctx: CallContext, input: ToolInput<N>) => Promise<Result<ToolOutput<N>>>;
};

export interface Ports {
	clock: Clock;
	catalog: Catalog;
	simulator: Simulator;
	decide: Decide;
	llm: Llm;
	web: Web;
	store: Store;
	ops: Ops;
	/** Menu proposals (Track B); plan_event{proposal} reads reviewed revisions from it. Absent = menus unsupported. */
	menus?: MenuStore;
	/** Procurement tasks (Ring 2). Absent = tasks unsupported. */
	tasks?: TaskStore;
}
