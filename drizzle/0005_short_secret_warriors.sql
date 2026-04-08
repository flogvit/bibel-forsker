ALTER TABLE "library" ADD COLUMN "project_id" integer;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "phase" varchar(30) DEFAULT 'literature_search' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "literature_review" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "identified_gaps" jsonb;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "library_count" integer DEFAULT 0 NOT NULL;