/**
 * Postgres schema (Aiven in prod, PGlite as the fixture). Contract-owned by the lead; core-db implements the store
 * against it. Documents are jsonb validated by the zod contracts; columns exist where something queries or locks them.
 */
import {
	bigint,
	boolean,
	index,
	integer,
	jsonb,
	numeric,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
	vector
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

/** A tenant. `lastSeq` is the per-workspace event sequence, bumped under `select … for update` (D6). */
export const workspaces = pgTable('workspaces', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	lastSeq: bigint('last_seq', { mode: 'number' }).notNull().default(0),
	createdAt: ts('created_at').notNull().defaultNow()
});

/** Demo/simulation runs; a reset starts a new run so old ops stay readable. */
export const runs = pgTable('runs', {
	id: text('id').primaryKey(),
	workspaceId: text('workspace_id')
		.notNull()
		.references(() => workspaces.id),
	label: text('label').notNull(),
	/** Simulator clock at run start (the December scenario date). */
	simStart: ts('sim_start').notNull(),
	createdAt: ts('created_at').notNull().defaultNow()
});

/** Kitchen profile + current mandate (contracts/kitchen.ts). Mandate history lives in the op log. */
export const kitchens = pgTable(
	'kitchens',
	{
		workspaceId: text('workspace_id')
			.notNull()
			.references(() => workspaces.id),
		id: text('id').notNull(),
		mandateVersion: integer('mandate_version').notNull().default(1),
		doc: jsonb('doc').notNull()
	},
	(t) => [primaryKey({ columns: [t.workspaceId, t.id] })]
);

/** Normalised catalogue (contracts/product.ts), shared across workspaces. Embedding is Ring 1+. */
export const products = pgTable(
	'products',
	{
		productId: text('product_id').primaryKey(),
		nameFi: text('name_fi').notNull(),
		nameEn: text('name_en'),
		category: text('category').notNull(),
		isFood: boolean('is_food').notNull(),
		doc: jsonb('doc').notNull(),
		embedding: vector('embedding', { dimensions: 768 })
	},
	(t) => [index('products_category_idx').on(t.category)]
);

/** Per-product cache of live terms (price/availability), keyed like the Valio cache (foundations/valio-data.md §5). */
export const offerCache = pgTable(
	'offer_cache',
	{
		endpoint: text('endpoint', { enum: ['price', 'availability'] }).notNull(),
		customer: text('customer').notNull(),
		requestedDate: text('requested_date').notNull(),
		productId: text('product_id').notNull(),
		body: jsonb('body').notNull(),
		fetchedAt: ts('fetched_at').notNull()
	},
	(t) => [primaryKey({ columns: [t.endpoint, t.customer, t.requestedDate, t.productId] })]
);

/** Simulator stock truth per run. Commit consumes with `update … set available = available - $q where available >= $q`. */
export const simStock = pgTable(
	'sim_stock',
	{
		workspaceId: text('workspace_id').notNull(),
		runId: text('run_id').notNull(),
		productId: text('product_id').notNull(),
		/** Null = unlimited (Valio sentinel ≥ 1e6). Unknown (Terminal) products have no row. */
		available: numeric('available', { mode: 'number' }),
		label: text('label').notNull()
	},
	(t) => [primaryKey({ columns: [t.workspaceId, t.runId, t.productId] })]
);

/** Plans with their lines as one document; version is the optimistic-concurrency token. */
export const plans = pgTable(
	'plans',
	{
		workspaceId: text('workspace_id').notNull(),
		runId: text('run_id').notNull(),
		id: text('id').notNull(),
		kitchenId: text('kitchen_id').notNull(),
		version: integer('version').notNull(),
		state: text('state').notNull(),
		doc: jsonb('doc').notNull(),
		updatedAt: ts('updated_at').notNull().defaultNow()
	},
	(t) => [
		primaryKey({ columns: [t.workspaceId, t.id] }),
		index('plans_run_idx').on(t.workspaceId, t.runId)
	]
);

export const approvals = pgTable(
	'approvals',
	{
		workspaceId: text('workspace_id').notNull(),
		id: text('id').notNull(),
		planId: text('plan_id').notNull(),
		state: text('state').notNull(),
		doc: jsonb('doc').notNull()
	},
	(t) => [primaryKey({ columns: [t.workspaceId, t.id] })]
);

/** Immutable once written. A plan can have several orders (partial commits), one per idempotency key. */
export const orders = pgTable(
	'orders',
	{
		workspaceId: text('workspace_id').notNull(),
		id: text('id').notNull(),
		planId: text('plan_id').notNull(),
		kitchenId: text('kitchen_id').notNull(),
		totalCents: integer('total_cents').notNull(),
		idempotencyKey: text('idempotency_key').notNull(),
		doc: jsonb('doc').notNull(),
		receipt: jsonb('receipt').notNull(),
		committedAt: ts('committed_at').notNull()
	},
	(t) => [
		primaryKey({ columns: [t.workspaceId, t.id] }),
		uniqueIndex('orders_plan_key_uq').on(t.workspaceId, t.planId, t.idempotencyKey)
	]
);

/** Locked budget row per kitchen-week for cumulative caps (D6: not two SUM queries). */
export const budgets = pgTable(
	'budgets',
	{
		workspaceId: text('workspace_id').notNull(),
		runId: text('run_id').notNull(),
		kitchenId: text('kitchen_id').notNull(),
		/** ISO week, e.g. 2026-W51. */
		week: text('week').notNull(),
		spentCents: integer('spent_cents').notNull().default(0)
	},
	(t) => [primaryKey({ columns: [t.workspaceId, t.runId, t.kitchenId, t.week] })]
);

/** Idempotency per (workspace, caller, key) with the request hash; same key + other payload = DUPLICATE. */
export const idempotency = pgTable(
	'idempotency',
	{
		workspaceId: text('workspace_id').notNull(),
		caller: text('caller').notNull(),
		tool: text('tool').notNull(),
		key: text('key').notNull(),
		requestHash: text('request_hash').notNull(),
		response: jsonb('response'),
		createdAt: ts('created_at').notNull().defaultNow()
	},
	(t) => [primaryKey({ columns: [t.workspaceId, t.caller, t.tool, t.key] })]
);

/** The op log (contracts/ops.ts OpEnvelope). Append-only. */
export const ops = pgTable(
	'ops',
	{
		workspaceId: text('workspace_id').notNull(),
		seq: bigint('seq', { mode: 'number' }).notNull(),
		runId: text('run_id').notNull(),
		type: text('type').notNull(),
		actorKind: text('actor_kind').notNull(),
		actorId: text('actor_id').notNull(),
		via: text('via').notNull(),
		at: ts('at').notNull(),
		envelope: jsonb('envelope').notNull()
	},
	(t) => [
		primaryKey({ columns: [t.workspaceId, t.seq] }),
		index('ops_run_idx').on(t.workspaceId, t.runId, t.seq)
	]
);

/** API keys: hashed, scoped, bound to a workspace and actor kind. Judges get one in the MCP URL path. */
export const apiKeys = pgTable('api_keys', {
	id: text('id').primaryKey(),
	workspaceId: text('workspace_id')
		.notNull()
		.references(() => workspaces.id),
	hash: text('hash').notNull().unique(),
	actorKind: text('actor_kind').notNull(),
	scopes: jsonb('scopes').notNull(),
	label: text('label').notNull(),
	createdAt: ts('created_at').notNull().defaultNow(),
	revokedAt: ts('revoked_at')
});

/**
 * Field-level suggestions about products (web, jobs, LLM), latest per workspace + product + field. Workspace-scoped
 * catalogue knowledge, so it survives a demo reset; the op log keeps the history. Never read as a verified fact (D6).
 */
export const enrichments = pgTable(
	'enrichments',
	{
		workspaceId: text('workspace_id')
			.notNull()
			.references(() => workspaces.id),
		productId: text('product_id').notNull(),
		field: text('field').notNull(),
		value: jsonb('value').notNull(),
		provenance: jsonb('provenance').notNull(),
		/** Op seq of the RecordEnrichment that set it; an upsert only wins with a higher seq. */
		seq: bigint('seq', { mode: 'number' }).notNull(),
		runId: text('run_id').notNull(),
		updatedAt: ts('updated_at').notNull().defaultNow()
	},
	(t) => [primaryKey({ columns: [t.workspaceId, t.productId, t.field] })]
);

/**
 * Menu proposals, one row per revision (Track B's MenuStore). Revisions never change; an edit is a new revision.
 * The review columns are written only by a chef's review command and bind to the revision's digest.
 */
export const menuProposals = pgTable(
	'menu_proposals',
	{
		workspaceId: text('workspace_id')
			.notNull()
			.references(() => workspaces.id),
		id: text('id').notNull(),
		revision: integer('revision').notNull(),
		kitchenId: text('kitchen_id').notNull(),
		status: text('status', { enum: ['proposed', 'chef_reviewed', 'planned'] }).notNull(),
		body: jsonb('body').notNull(),
		digest: text('digest').notNull(),
		reviewedByKind: text('reviewed_by_kind'),
		reviewedById: text('reviewed_by_id'),
		reviewedAt: ts('reviewed_at'),
		reviewDigest: text('review_digest'),
		createdAt: ts('created_at').notNull().defaultNow()
	},
	(t) => [
		primaryKey({ columns: [t.workspaceId, t.id, t.revision] }),
		index('menu_proposals_latest').on(t.workspaceId, t.id, t.revision.desc())
	]
);

/** Procurement tasks (Ring 2): one row per task, the document versioned for compare-and-set writes. */
export const agentTasks = pgTable(
	'agent_tasks',
	{
		workspaceId: text('workspace_id')
			.notNull()
			.references(() => workspaces.id),
		id: text('id').notNull(),
		kitchenId: text('kitchen_id').notNull(),
		state: text('state').notNull(),
		version: integer('version').notNull(),
		doc: jsonb('doc').notNull(),
		updatedAt: ts('updated_at').notNull().defaultNow()
	},
	(t) => [
		primaryKey({ columns: [t.workspaceId, t.id] }),
		index('agent_tasks_open').on(t.workspaceId, t.kitchenId, t.state)
	]
);
