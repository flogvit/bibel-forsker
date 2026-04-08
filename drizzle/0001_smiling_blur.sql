CREATE TABLE "discoveries" (
	"id" serial PRIMARY KEY NOT NULL,
	"finding_id" integer NOT NULL,
	"title" text NOT NULL,
	"claim" text NOT NULL,
	"evidence_strength" varchar(20) NOT NULL,
	"status" varchar(30) DEFAULT 'pending_verification' NOT NULL,
	"literature_search" jsonb,
	"theological_review" jsonb,
	"novelty_assessment" text,
	"paper" text,
	"paper_status" varchar(20),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_discoveries_status" ON "discoveries" USING btree ("status");