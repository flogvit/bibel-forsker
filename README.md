# Bibel-Forsker

An autonomous AI system that researches the Bible the way a human researcher would — reading methodology, building competence, analyzing texts, discovering patterns, and producing findings.

## What It Does

The system runs continuously, orchestrating specialized AI agents that each focus on one aspect of biblical research:

- **Pensum agents** build competence by reading research methodology, academic articles, and learning new techniques
- **Forsker (research) agents** perform actual analysis — linguistic, intertextual, historical, form criticism, etc.
- **Scout agents** monitor new publications and AI techniques
- **Evaluator** ensures quality through triangulation and bias checking
- **Aggregator** synthesizes findings using the hermeneutic circle

A central **Rektor** orchestrates everything, reflects on what works, and evolves its strategy over time via `research-rules.md`.

## Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL
- Ollama (for local models) or Anthropic API key

### Setup

```bash
npm install

# Create database
psql -U postgres -c "CREATE DATABASE bibel_forsker;"

# Configure
cp .env.example .env
# Edit .env with your database URL and API keys

# Run migrations
npm run db:migrate
```

### Run

```bash
# Seed initial research tasks
npx tsx src/cli.ts seed

# Start with local Ollama model
npx tsx src/cli.ts start --local

# Or start with Claude API
npx tsx src/cli.ts start

# Check what's happening
npx tsx src/cli.ts status
npx tsx src/cli.ts report

# Give direction
npx tsx src/cli.ts focus "intertextual connections between Isaiah and NT"
npx tsx src/cli.ts comment "Interesting finding, explore further"

# Stop
npx tsx src/cli.ts stop
```

### Tests

```bash
npm test
```

## Architecture

Inspired by:
- **aksjer autotrader** — daily learning cycles with persistent rules
- **flogvit-coder** — supervisor pattern with self-improvement
- **Ms. Pac-Man (Microsoft)** — 150+ specialized agents weighted by signal intensity
- **DeepMind AlphaGo/AlphaFold** — iterative refinement, policy/value evaluation

See `docs/superpowers/specs/2026-04-08-bibel-forsker-design.md` for full design rationale, including what we considered and rejected.

## Current Version: v0.0.1

Minimal viable system with:
- Rektor orchestrator (event loop, reflection)
- Methodology reader agent (pensum)
- Linguist agent (forsker)
- LLM abstraction (Claude API + Ollama)
- Free-bible data access layer
- PostgreSQL state management
- CLI control

## Data

Uses Bible data from the [free-bible](https://github.com/flogvit/free-bible) project (Hebrew/Greek source texts, Norwegian translations, word-by-word analysis, cross-references).

## License

MIT
