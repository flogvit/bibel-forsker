# Bibel-Forsker

Autonomous AI Bible research system. See `docs/superpowers/specs/2026-04-08-bibel-forsker-design.md` for full architecture and design rationale.

## Project Structure

```
src/
├── cli.ts                         # CLI entry point (start/stop/status/report/comment/focus/seed)
├── rektor/                        # Orchestrator
│   ├── rektor.ts                  # Event loop, agent dispatch, periodic reflection
│   ├── reflector.ts               # Post-task reflection, updates research-rules.md
│   └── state.ts                   # Graceful shutdown/restart, state serialization
├── agents/
│   ├── base-agent.ts              # Abstract base class for all agents
│   ├── pensum/
│   │   └── methodology-reader.ts  # Downloads and processes research methodology
│   └── forsker/
│       └── linguist.ts            # Linguistic analysis using free-bible data
├── llm/
│   ├── llm.ts                     # Unified LLM interface (Claude + Ollama)
│   └── prompts.ts                 # Prompt templates for agents
├── data/
│   └── free-bible.ts              # Read-only access to ../free-bible/generate/ data
└── db/
    ├── connection.ts              # Database connection pool
    ├── schema.ts                  # Drizzle table definitions
    └── migrate.ts                 # Migration runner
```

## Running

```bash
bun src/cli.ts seed             # Seed initial tasks
bun src/cli.ts start --local    # Start with Ollama for agents
bun src/cli.ts start            # Start with Claude for all
bun src/cli.ts status           # Check status
bun src/cli.ts report           # View findings
bun src/cli.ts stop             # Graceful shutdown
```

## Tech Stack

- TypeScript (ESM modules), run with bun
- PostgreSQL via bun:sql + Drizzle ORM
- claude -p CLI for Claude calls + Ollama for local models
- bun test for testing

## Conventions

- ESM modules — use .js extensions for local imports
- Run with bun, not tsx/node
- TDD — write tests first, use bun test
- Agents extend `BaseAgent` and implement `execute()`
- All findings are immutable (append-only in database)
- research-rules.md evolves over time — Rektor updates it after reflection cycles

## Database

PostgreSQL on localhost:5432, database `bibel_forsker`, user `postgres`.

Tables: `agent_tasks` (queue), `findings` (immutable results), `research_log` (event log), `agent_state` (shutdown/restart), `pensum_articles` (what we've read).

Migrations: `bun run db:migrate`

## Data Sources

- `../free-bible/generate/` — Bible texts, translations, word-by-word, cross-references (read-only)
- research-rules.md — evolving research strategy

## Key Design Decisions

- Inspired by aksjer autotrader (daily learning), flogvit-coder (supervisor), Ms. Pac-Man (parallel specialized agents), DeepMind (iterative refinement)
- Continuous event loop, not cron-based
- Agents are "egoistic" specialists — Aggregator weighs by evidence strength, not majority
- System tracks its own assumptions (Heidegger's fore-structures) and challenges them
- Errors are OK — we learn from them
