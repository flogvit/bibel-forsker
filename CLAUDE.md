# Bibel-Forsker

Autonomt AI bibelforskning-system. Se `docs/superpowers/specs/2026-04-08-bibel-forsker-design.md` for designspec.

## Project Structure

```
src/
├── cli.ts                         # CLI (start/stop/status/report/comment/focus/seed/web)
├── rektor/
│   ├── dispatcher.ts              # Event-drevet dispatcher med worker pool (erstatter rektor.ts)
│   ├── rektor.ts                  # Gammel event-loop (erstattet av dispatcher)
│   ├── reflector.ts               # Refleksjon etter fullførte oppgaver
│   ├── triage.ts                  # Vurderer/splitter for brede oppgaver
│   ├── reviewer.ts                # Validerer funn etter fullføring
│   ├── supervisor.ts              # Overvåker systemhelse
│   └── state.ts                   # State serialisering for start/stopp
├── agents/
│   ├── base-agent.ts              # Abstrakt base for forsker-agenter
│   ├── pensum/
│   │   └── methodology-reader.ts  # Leser forskningsmetodikk
│   ├── forsker/
│   │   └── linguist.ts            # Lingvistisk analyse av bibeltekst
│   ├── scout/
│   │   ├── doaj-api.ts            # DOAJ kildeagent — laster ned ALT fra DOAJ
│   │   ├── fulltext-fetcher.ts    # Henter fulltekst for artikler som bare har abstract
│   │   └── cataloguer.ts          # Katalogiserer nedlastet materiale
│   ├── synthesis-agent.ts         # Finner klynger av relaterte funn
│   └── discovery-pipeline.ts      # Novelty → litteratursøk → review → paper → referansesjekk
├── llm/
│   ├── llm.ts                     # LLM-lag: claude -p (stdin) + Ollama. Rate limit-håndtering.
│   ├── prompts.ts                 # Alle prompts (norsk)
│   └── embeddings.ts              # pgvector embeddings via Ollama nomic-embed-text
├── data/
│   └── free-bible.ts              # Leser fra ../free-bible/generate/ (read-only)
├── web/
│   ├── server.ts                  # Bun.serve med API-er
│   ├── dashboard.html             # Hoveddashboard med tabs
│   ├── projects.html              # Prosjektliste
│   └── project.html               # Enkeltprosjekt-visning
└── db/
    ├── connection.ts              # bun:sql + Drizzle ORM
    ├── schema.ts                  # Alle tabeller
    └── migrate.ts                 # Migrasjoner
```

## Running

```bash
bibel-forsker start              # Start dispatcher (4 workers)
bibel-forsker start --local      # Ollama for agent-oppgaver
bibel-forsker start --concurrency 6
bibel-forsker stop               # Graceful shutdown
bibel-forsker status             # Sjekk status
bibel-forsker report             # Siste funn
bibel-forsker seed               # Seed initielle oppgaver
bibel-forsker web                # Dashboard på port 3051
bibel-forsker focus "tema"       # Sett forskningsfokus
bibel-forsker comment "tekst"    # Legg til kommentar
```

## Tech Stack

- Bun runtime, bun:sql, bun test
- PostgreSQL + pgvector + Drizzle ORM
- Claude Code CLI (`claude -p` via stdin, `--dangerously-skip-permissions`)
- Ollama for embeddings (nomic-embed-text) og fulltekst-henting (gemma3:27b via `ollama launch claude`)

## Konvensjoner

- ESM modules med .js extensions
- Bun, ikke Node/tsx
- Prompts på norsk
- Funn er immutable (append-only)
- research/strategy.md oppdateres manuelt av eier, ikke av AI
- Kildeagenter er autonome — de laster ned ALT, ikke et begrenset antall
- Kildeagent-konfigurasjon i research/sources/*.json

## Database

PostgreSQL localhost:5432, database `bibel_forsker`, bruker `postgres`.

Tabeller:
- `agent_tasks` — oppgavekø (med projectId for prosjektoppgaver)
- `findings` — immutable forskningsfunn (med projectId)
- `research_log` — alt som skjer, aldri slettet
- `discoveries` — potensielt unike funn med paper-pipeline
- `library` — nedlastet akademisk materiale (~10K artikler fra DOAJ)
- `embeddings` — pgvector for RAG-søk
- `projects` — forskningsprosjekter med fase-basert flyt

Migrasjoner: `bun run db:migrate`

## Kildeagenter

Kildeagenter er autonome nedlastere. Hver agent har sin konfigfil i `research/sources/`.

- **DOAJ** (`research/sources/doaj.json`) — søketermer for DOAJ API. Agenten paginerer gjennom ALT.
- **Fulltekst-henter** — følger URL-er og henter selve artikkelen. Direkte fetch først, Ollama-fallback for å finne riktig lenke.
- **Katalogiserer** — klassifiserer, tagger, vurderer troverdighet/fagfellevurdering, genererer embeddings.

## Dispatcher

Event-drevet (`src/rektor/dispatcher.ts`). Ticker hvert 2. sekund, fyller ledige worker-slots med prioritert arbeid:

1. Katalogisering (ukatalogisert materiale)
2. Aktive prosjekter (fase-basert)
3. Pending forskningsoppgaver (prosjektoppgaver prioriteres)
4. Refleksjon (etter 3 oppgaver)
5. Syntese + discovery pipeline (etter 15 oppgaver)
6. Generer nye oppgaver (tom kø)
7. Supervisor (hvert 5. min)
8. DOAJ kildeagent (ved oppstart, deretter daglig)

Ved restart: resetter orphaned in_progress tasks til pending.
Ved rate limit: alle workers pauser, dashboard viser PAUSET.

## Prosjekter

Fase-basert flyt: `literature_search → literature_review → identify_gaps → research → paper`

Prosjekter opprettes via dashboard (/projects). Hver fase fullføres før neste starter. Litteratur lastes ned og gjennomgås FØR forskning starter.

## Paper pipeline

Funn → novelty check → litteratursøk → teologisk review → paper → originalitetssjekk (websøk) → referansesjekk (verifiserer ekte referanser) → fagfellevurdering → revisjon → godkjent/avvist.

## Viktig

- Kildeagenter laster ned ALT — ikke begrens med --pages eller lignende
- Forskning skal ikke starte før biblioteket er fylt med eksisterende forskning
- Prosjekter gjør litteratursøk FØR forskning
- Stopp prosesser med `pkill -f "bun src/cli"` — IKKE `pkill -f "bun"` (treffer systemprosesser)
