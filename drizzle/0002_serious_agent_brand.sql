CREATE TABLE "embeddings" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_type" varchar(50) NOT NULL,
	"source_id" integer,
	"content" text NOT NULL,
	"embedding" vector(768),
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_embeddings_source" ON "embeddings" USING btree ("source_type","source_id");