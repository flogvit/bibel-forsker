CREATE TABLE "agent_state" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_type" varchar(100) NOT NULL,
	"state" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agent_state_agent_type_unique" UNIQUE("agent_type")
);
--> statement-breakpoint
CREATE TABLE "agent_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_type" varchar(100) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"payload" jsonb NOT NULL,
	"result" jsonb,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "findings" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_type" varchar(100) NOT NULL,
	"task_id" integer,
	"finding" text NOT NULL,
	"evidence_strength" varchar(20) NOT NULL,
	"reasoning" text NOT NULL,
	"sources" jsonb NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pensum_articles" (
	"id" serial PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"source" varchar(200),
	"summary" text,
	"key_learnings" jsonb,
	"inclusion_reason" text,
	"processed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_type" varchar(50) NOT NULL,
	"agent_type" varchar(100),
	"details" jsonb NOT NULL,
	"tokens_used" integer,
	"model" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_tasks_status" ON "agent_tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_tasks_agent_type" ON "agent_tasks" USING btree ("agent_type");--> statement-breakpoint
CREATE INDEX "idx_findings_agent" ON "findings" USING btree ("agent_type");--> statement-breakpoint
CREATE INDEX "idx_findings_strength" ON "findings" USING btree ("evidence_strength");--> statement-breakpoint
CREATE INDEX "idx_log_event" ON "research_log" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "idx_log_created" ON "research_log" USING btree ("created_at");