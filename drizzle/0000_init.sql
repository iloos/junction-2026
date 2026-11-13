CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"hash" text NOT NULL,
	"actor_kind" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_keys_hash_unique" UNIQUE("hash")
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"plan_id" text NOT NULL,
	"state" text NOT NULL,
	"doc" jsonb NOT NULL,
	CONSTRAINT "approvals_workspace_id_id_pk" PRIMARY KEY("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"workspace_id" text NOT NULL,
	"run_id" text NOT NULL,
	"kitchen_id" text NOT NULL,
	"week" text NOT NULL,
	"spent_cents" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "budgets_workspace_id_run_id_kitchen_id_week_pk" PRIMARY KEY("workspace_id","run_id","kitchen_id","week")
);
--> statement-breakpoint
CREATE TABLE "idempotency" (
	"workspace_id" text NOT NULL,
	"caller" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_workspace_id_caller_key_pk" PRIMARY KEY("workspace_id","caller","key")
);
--> statement-breakpoint
CREATE TABLE "kitchens" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"mandate_version" integer DEFAULT 1 NOT NULL,
	"doc" jsonb NOT NULL,
	CONSTRAINT "kitchens_workspace_id_id_pk" PRIMARY KEY("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "offer_cache" (
	"endpoint" text NOT NULL,
	"customer" text NOT NULL,
	"requested_date" text NOT NULL,
	"product_id" text NOT NULL,
	"body" jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	CONSTRAINT "offer_cache_endpoint_customer_requested_date_product_id_pk" PRIMARY KEY("endpoint","customer","requested_date","product_id")
);
--> statement-breakpoint
CREATE TABLE "ops" (
	"workspace_id" text NOT NULL,
	"seq" bigint NOT NULL,
	"run_id" text NOT NULL,
	"type" text NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_id" text NOT NULL,
	"via" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"envelope" jsonb NOT NULL,
	CONSTRAINT "ops_workspace_id_seq_pk" PRIMARY KEY("workspace_id","seq")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"plan_id" text NOT NULL,
	"kitchen_id" text NOT NULL,
	"total_cents" integer NOT NULL,
	"doc" jsonb NOT NULL,
	"receipt" jsonb NOT NULL,
	"committed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "orders_workspace_id_id_pk" PRIMARY KEY("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"workspace_id" text NOT NULL,
	"run_id" text NOT NULL,
	"id" text NOT NULL,
	"kitchen_id" text NOT NULL,
	"version" integer NOT NULL,
	"state" text NOT NULL,
	"doc" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_workspace_id_id_pk" PRIMARY KEY("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"product_id" text PRIMARY KEY NOT NULL,
	"name_fi" text NOT NULL,
	"name_en" text,
	"category" text NOT NULL,
	"is_food" boolean NOT NULL,
	"doc" jsonb NOT NULL,
	"embedding" vector(768)
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"label" text NOT NULL,
	"sim_start" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sim_stock" (
	"workspace_id" text NOT NULL,
	"run_id" text NOT NULL,
	"product_id" text NOT NULL,
	"available" numeric,
	"label" text NOT NULL,
	CONSTRAINT "sim_stock_workspace_id_run_id_product_id_pk" PRIMARY KEY("workspace_id","run_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"last_seq" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kitchens" ADD CONSTRAINT "kitchens_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ops_run_idx" ON "ops" USING btree ("workspace_id","run_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_plan_uq" ON "orders" USING btree ("workspace_id","plan_id");--> statement-breakpoint
CREATE INDEX "plans_run_idx" ON "plans" USING btree ("workspace_id","run_id");--> statement-breakpoint
CREATE INDEX "products_category_idx" ON "products" USING btree ("category");