CREATE TABLE "agent_tasks" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"kitchen_id" text NOT NULL,
	"state" text NOT NULL,
	"version" integer NOT NULL,
	"doc" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_tasks_workspace_id_id_pk" PRIMARY KEY("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_tasks_open" ON "agent_tasks" USING btree ("workspace_id","kitchen_id","state");