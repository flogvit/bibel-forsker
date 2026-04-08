CREATE TABLE "library" (
	"id" serial PRIMARY KEY NOT NULL,
	"url" text,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"content_type" varchar(50) NOT NULL,
	"language" varchar(10) DEFAULT 'no',
	"tags" jsonb,
	"topics" jsonb,
	"relevant_methods" jsonb,
	"relevant_books" jsonb,
	"quality_score" integer,
	"peer_reviewed" varchar(20),
	"source_credibility" varchar(20),
	"author" text,
	"publication_year" integer,
	"summary" text,
	"status" varchar(20) DEFAULT 'raw' NOT NULL,
	"scouted_at" timestamp DEFAULT now() NOT NULL,
	"catalogued_at" timestamp
);
--> statement-breakpoint
CREATE INDEX "idx_library_status" ON "library" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_library_type" ON "library" USING btree ("content_type");