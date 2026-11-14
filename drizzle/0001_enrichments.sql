CREATE TABLE "enrichments" (
	"workspace_id" text NOT NULL,
	"product_id" text NOT NULL,
	"field" text NOT NULL,
	"value" jsonb NOT NULL,
	"provenance" jsonb NOT NULL,
	"seq" bigint NOT NULL,
	"run_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enrichments_workspace_id_product_id_field_pk" PRIMARY KEY("workspace_id","product_id","field")
);
--> statement-breakpoint
ALTER TABLE "enrichments" ADD CONSTRAINT "enrichments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;