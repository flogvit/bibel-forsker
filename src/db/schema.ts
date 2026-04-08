import {
  pgTable,
  serial,
  text,
  timestamp,
  jsonb,
  integer,
  varchar,
  index,
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
