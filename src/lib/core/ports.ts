/**
 * Ports: every outside dependency the core needs. Each has a real adapter and a fixture adapter
 * (CLAUDE.md rule 2) under src/lib/server/adapters/<port>/. The core imports only these types.
 */
import type {
	Actor,
	DomainError,
	Kitchen,
	Offer,
	OpEnvelope,
	PendingOp,
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
}

/** Simulator: stock truth and scenario overlays (contention, split delivery, cut-off). */
export interface Simulator {
	/** Atomic conditional consume at commit (`… where available >= qty`). Runs inside the store transaction. */
	consume(tx: Tx, productId: ProductId, qty: number): Promise<Result<{ lotId: string }>>;
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
}
export interface Decision<T> {
	value: T;
	confidence: number;
	source: 'gemini' | 'replay' | 'rules';
	model?: string;
	latencyMs: number;
}

/** Free-text / tool-calling model (Gemini flash-lite, Gemma via Featherless/Verda). Every call is traced. */
export interface Llm {
	generate(req: { system?: string; prompt: string; maxTokens: number; json?: boolean }): Promise<{
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

/** Background jobs (Modal). Jobs write back only through scoped APIs, never the DB. */
export interface Jobs {
	enqueue(job: { name: string; input: unknown }): Promise<{ jobId: string }>;
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
	/** Idempotency: unique per (workspace, caller, key) with a request hash. */
	idempotency(
		tx: Tx,
		k: { workspaceId: string; caller: string; key: string; requestHash: string }
	): Promise<{ status: 'new' } | { status: 'replay'; response: unknown } | { status: 'conflict' }>;
	rememberResponse(
		tx: Tx,
		k: { workspaceId: string; caller: string; key: string },
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
	jobs: Jobs;
	store: Store;
	ops: Ops;
}
