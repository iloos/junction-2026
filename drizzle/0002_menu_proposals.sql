CREATE TABLE "menu_proposals" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"revision" integer NOT NULL,
	"kitchen_id" text NOT NULL,
	"status" text NOT NULL,
	"body" jsonb NOT NULL,
	"digest" text NOT NULL,
	"reviewed_by_kind" text,
	"reviewed_by_id" text,
	"reviewed_at" timestamp with time zone,
	"review_digest" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "menu_proposals_workspace_id_id_revision_pk" PRIMARY KEY("workspace_id","id","revision")
);
--> statement-breakpoint
ALTER TABLE "menu_proposals" ADD CONSTRAINT "menu_proposals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "menu_proposals_latest" ON "menu_proposals" USING btree ("workspace_id","id","revision" DESC NULLS LAST);