CREATE TABLE "projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"workers" integer DEFAULT 2 NOT NULL,
	"findings_count" integer DEFAULT 0 NOT NULL,
	"paper_draft" text,
	"paper_status" varchar(20),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD COLUMN "project_id" integer;--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "project_id" integer;--> statement-breakpoint
CREATE INDEX "idx_tasks_project" ON "agent_tasks" USING btree ("project_id");