import {
  pgTable,
  serial,
  text,
  timestamp,
  jsonb,
  integer,
  varchar,
  index,
  vector,
} from 'drizzle-orm/pg-core';

// Task queue for agents — Rektor puts tasks here, agents pick them up
export const agentTasks = pgTable('agent_tasks', {
  id: serial('id').primaryKey(),
  agentType: varchar('agent_type', { length: 100 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  priority: integer('priority').notNull().default(0),
  payload: jsonb('payload').notNull(),
  result: jsonb('result'),
  error: text('error'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
}, (table) => [
  index('idx_tasks_status').on(table.status),
  index('idx_tasks_agent_type').on(table.agentType),
]);

// Research findings — immutable append-only log of everything discovered
export const findings = pgTable('findings', {
  id: serial('id').primaryKey(),
  agentType: varchar('agent_type', { length: 100 }).notNull(),
  taskId: integer('task_id'),
  finding: text('finding').notNull(),
  evidenceStrength: varchar('evidence_strength', { length: 20 }).notNull(),
  reasoning: text('reasoning').notNull(),
  sources: jsonb('sources').notNull(),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('idx_findings_agent').on(table.agentType),
  index('idx_findings_strength').on(table.evidenceStrength),
]);

// Immutable event log — everything that happens, never deleted
export const researchLog = pgTable('research_log', {
  id: serial('id').primaryKey(),
  eventType: varchar('event_type', { length: 50 }).notNull(),
  agentType: varchar('agent_type', { length: 100 }),
  details: jsonb('details').notNull(),
  tokensUsed: integer('tokens_used'),
  model: varchar('model', { length: 100 }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('idx_log_event').on(table.eventType),
  index('idx_log_created').on(table.createdAt),
]);

// Agent state — for graceful shutdown/restart
export const agentState = pgTable('agent_state', {
  id: serial('id').primaryKey(),
  agentType: varchar('agent_type', { length: 100 }).notNull().unique(),
  state: jsonb('state').notNull(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// Discoveries — potentially unique findings that go through verification pipeline
export const discoveries = pgTable('discoveries', {
  id: serial('id').primaryKey(),
  findingId: integer('finding_id').notNull(),  // Link to original finding
  title: text('title').notNull(),
  claim: text('claim').notNull(),              // What we think is new
  evidenceStrength: varchar('evidence_strength', { length: 20 }).notNull(),
  status: varchar('status', { length: 30 }).notNull().default('pending_verification'),
  // Pipeline stages
  literatureSearch: jsonb('literature_search'),   // What we found online
  theologicalReview: jsonb('theological_review'), // How it relates to mainstream
  noveltyAssessment: text('novelty_assessment'),  // Is it actually new?
  // If it survives verification, a paper is written
  paper: text('paper'),                           // Full paper markdown
  paperStatus: varchar('paper_status', { length: 20 }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  index('idx_discoveries_status').on(table.status),
]);

// Embeddings for RAG — semantic search across all knowledge
export const embeddings = pgTable('embeddings', {
  id: serial('id').primaryKey(),
  sourceType: varchar('source_type', { length: 50 }).notNull(), // 'finding', 'verse', 'article', 'method'
  sourceId: integer('source_id'),
  content: text('content').notNull(),
  embedding: vector('embedding', { dimensions: 768 }),  // nomic-embed-text dimension
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('idx_embeddings_source').on(table.sourceType, table.sourceId),
]);

// Pensum articles — what we've read and learned
export const pensumArticles = pgTable('pensum_articles', {
  id: serial('id').primaryKey(),
  url: text('url').notNull(),
  title: text('title').notNull(),
  source: varchar('source', { length: 200 }),
  summary: text('summary'),
  keyLearnings: jsonb('key_learnings'),
  inclusionReason: text('inclusion_reason'),
  processedAt: timestamp('processed_at').notNull().defaultNow(),
});

// Library — downloaded and catalogued research material
export const library = pgTable('library', {
  id: serial('id').primaryKey(),
  url: text('url'),
  title: text('title').notNull(),
  content: text('content').notNull(),             // Full text content
  contentType: varchar('content_type', { length: 50 }).notNull(), // 'article', 'book_chapter', 'encyclopedia', 'methodology', 'manuscript_info'
  language: varchar('language', { length: 10 }).default('no'),
  // Cataloguing metadata (filled by cataloguer agent)
  tags: jsonb('tags'),                             // ['hermeneutikk', 'tekstkritikk', ...]
  topics: jsonb('topics'),                         // ['hesed', 'paktsteologi', ...]
  relevantMethods: jsonb('relevant_methods'),      // ['grounded-theory', 'textual-criticism']
  relevantBooks: jsonb('relevant_books'),           // [1, 19, 23] — Bible book IDs
  qualityScore: integer('quality_score'),           // 1-5, set by cataloguer
  peerReviewed: varchar('peer_reviewed', { length: 20 }),  // 'yes', 'no', 'unknown'
  sourceCredibility: varchar('source_credibility', { length: 20 }), // 'academic', 'encyclopedia', 'popular', 'blog', 'unknown'
  author: text('author'),
  publicationYear: integer('publication_year'),
  summary: text('summary'),                        // Cataloguer's summary
  status: varchar('status', { length: 20 }).notNull().default('raw'), // 'raw', 'catalogued', 'embedded'
  scoutedAt: timestamp('scouted_at').notNull().defaultNow(),
  cataloguedAt: timestamp('catalogued_at'),
}, (table) => [
  index('idx_library_status').on(table.status),
  index('idx_library_type').on(table.contentType),
]);
