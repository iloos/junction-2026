CREATE TABLE "traces" (
	"id" text PRIMARY KEY NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"request_id" text,
	"workspace_id" text,
	"run_id" text,
	"actor_kind" text,
	"actor_id" text,
	"via" text,
	"step" text NOT NULL,
	"source" text NOT NULL,
	"model" text,
	"tool" text,
	"tokens_in" integer,
	"tokens_out" integer,
	"latency_ms" integer,
	"cache" text,
	"ok" boolean NOT NULL,
	"error" text,
	"cost_units" numeric,
	"data" jsonb
);
--> statement-breakpoint
CREATE INDEX "traces_at" ON "traces" USING btree ("at");--> statement-breakpoint
CREATE INDEX "traces_ws_at" ON "traces" USING btree ("workspace_id","at");--> statement-breakpoint
CREATE INDEX "traces_request" ON "traces" USING btree ("request_id");