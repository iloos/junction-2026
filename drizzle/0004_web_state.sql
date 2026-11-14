CREATE TABLE "web_applications" (
	"key" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"run_id" text NOT NULL,
	"finding_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"doc" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "web_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"api" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"value" jsonb NOT NULL,
	"cost_units" numeric
);
--> statement-breakpoint
CREATE TABLE "web_findings" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text,
	"kind" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"doc" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "web_queue" (
	"id" text PRIMARY KEY NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"locked_by" text,
	"locked_until" timestamp with time zone,
	"doc" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "web_spend" (
	"day" text NOT NULL,
	"api" text NOT NULL,
	"key" text NOT NULL,
	"n" integer NOT NULL,
	CONSTRAINT "web_spend_day_api_key_pk" PRIMARY KEY("day","api","key")
);
--> statement-breakpoint
CREATE INDEX "web_applications_ws" ON "web_applications" USING btree ("workspace_id","run_id");--> statement-breakpoint
CREATE INDEX "web_findings_kind" ON "web_findings" USING btree ("kind","at");--> statement-breakpoint
CREATE INDEX "web_queue_due" ON "web_queue" USING btree ("at");