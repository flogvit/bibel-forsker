# Bibel-Forsker

Et autonomt AI-system som forsker på Bibelen slik en menneskelig forsker ville gjort — leser metodikk, bygger kompetanse, analyserer tekster, oppdager mønstre, og produserer forskningsartikler.

## Hva det gjør

Systemet kjører kontinuerlig med en event-drevet dispatcher som koordinerer spesialiserte AI-agenter:

**Forskning:**
- **Lingvist** — analyserer hebraisk/gresk originaltekst, semantiske felt, grammatikk, intertekstuelle koblinger
- **Metodikk-leser** — bygger kompetanse ved å lese forskningsmetodikk, hermeneutikk, tekstkritikk

**Kvalitetssikring:**
- **Triage** — vurderer om oppgaver er for brede, splitter dem i håndterbare deloppgaver
- **Reviewer** — validerer funn etter fullføring, vurderer evidensstyrke
- **Supervisor** — overvåker systemhelse, diagnostiserer feil, rydder opp

**Kunnskapsbygging:**
- **Scout-agenter** — henter akademisk materiale fra IxTheo, Google Scholar, Idunn, Wikipedia, DOAJ
- **Katalogiserer** — klassifiserer nedlastet materiale med tags, troverdighet, fagfellevurdering
- **RAG/Embeddings** — semantisk søk via pgvector og Ollama nomic-embed-text

**Syntese og publisering:**
- **Syntese-agent** — finner klynger av relaterte funn som kan bli forskningsartikler
- **Discovery pipeline** — novelty check → litteratursøk → teologisk review → referansesjekk → paper-skriving → fagfellevurdering → revisjon

## Dashboard

Live web-dashboard på http://localhost:3051 med fire tabs:

- **Forskning** — systemstatus, aktive agenter, oppgavekø, siste funn, forskningslogg
- **Papers & oppdagelser** — forskningsartikler, klynger, oppdagelser med papers
- **Bibliotek** — nedlastet akademisk materiale, semantisk søk (RAG)
- **System** — forskningskunnskap, metoder, agentinstrukser

## Hurtigstart

### Forutsetninger

- [Bun](https://bun.sh) runtime
- PostgreSQL (med pgvector-utvidelse)
- [Claude Code](https://claude.ai/code) CLI (`claude` kommando)
- Ollama (valgfritt, for embeddings og lokal kjøring)

### Oppsett

```bash
bun install

# Opprett database
psql -U postgres -c "CREATE DATABASE bibel_forsker;"
psql -U postgres -d bibel_forsker -c "CREATE EXTENSION IF NOT EXISTS vector;"

# Konfigurer
cp .env.example .env
# Rediger .env med din database-URL

# Kjør migrasjoner
bun run db:migrate

# For semantisk søk (valgfritt)
ollama pull nomic-embed-text

# Installer som global kommando
bun link
```

### Kjøring

```bash
# Seed initielle oppgaver
bibel-forsker seed

# Start forskning (4 parallelle workers)
bibel-forsker start

# Start med Ollama for agent-oppgaver
bibel-forsker start --local

# Juster parallellitet
bibel-forsker start --concurrency 6

# Start dashboard
bibel-forsker web

# Sjekk status
bibel-forsker status
bibel-forsker report

# Gi retning
bibel-forsker focus "intertekstuelle koblinger mellom Jesaja og NT"
bibel-forsker comment "Interessant funn, utforsk dette mer"

# Stopp
bibel-forsker stop
```

### Tester

```bash
bun test
```

## Arkitektur

### Dispatcher

Event-drevet dispatcher med konfigurerbar parallellitet (standard 4 workers). Fyller ledige slots umiddelbart med høyest prioritert arbeid:

1. **Katalogisering** — så lenge det er ukatalogisert materiale
2. **Forskning** — pending oppgaver i køen
3. **Refleksjon** — etter hver 3. fullførte oppgave
4. **Syntese** — etter hver 15. oppgave, finner klynger for papers
5. **Generer arbeid** — når køen er tom
6. **Supervisor** — helsekontroll hvert 5. minutt
7. **Scout** — henter nytt materiale hver time

### Rate limit-håndtering

Alle workers pauser automatisk når Claude melder rate limit. Systemet viser "PAUSET" på dashboardet og gjenopptar når ventetiden er over.

### Forskningskunnskap

Forskningsmetodikk og instrukser er organisert i separate filer:

```
research/
├── strategy.md            # Overordnet forskningsstrategi
├── methods/
│   ├── hermeneutics.md    # Hermeneutisk metode
│   ├── textual-criticism.md
│   ├── grounded-theory.md
│   ├── source-criticism.md
│   ├── narrative-criticism.md
│   └── intertextual-analysis.md
└── agents/
    ├── linguist.md        # Instrukser for lingvisten
    └── methodology-reader.md
```

Agenter leser sine relevante metoder og instrukser fra filene. Strategien oppdateres manuelt.

### Paper pipeline

Funn med sterk evidens → novelty check → litteratursøk online → teologisk review → paper-skriving → **referansesjekk** (verifiserer at referanser er ekte, fjerner AI-hallusinerte) → fagfellevurdering → revisjon → godkjent/avvist.

### Tech stack

- **Bun** — runtime, test runner, package manager
- **PostgreSQL** + pgvector — database, embeddings, RAG
- **Drizzle ORM** — type-safe database-lag
- **Claude Code CLI** (`claude -p`) — all LLM-reasoning
- **Ollama** — lokal embedding-modell (nomic-embed-text)
- **Commander.js** — CLI

### Databaser

| Tabell | Innhold |
|--------|---------|
| `agent_tasks` | Oppgavekø med status, prioritet, payload |
| `findings` | Immutable forskningsfunn med evidensgradering |
| `research_log` | Alt som skjer i systemet (aldri slettet) |
| `discoveries` | Potensielt unike funn med paper-pipeline |
| `library` | Nedlastet akademisk materiale med katalogisering |
| `embeddings` | pgvector embeddings for RAG-søk |

## Inspirasjonskilder

- **aksjer autotrader** — daglige læringssykluser med persistent strategi
- **flogvit-coder** — supervisor-mønster, self-improvement, rate limit-håndtering
- **Ms. Pac-Man (Microsoft)** — spesialiserte parallelle agenter vektet etter intensitet
- **DeepMind AlphaGo/AlphaFold** — iterativ raffinering, policy/value-evaluering

Se `docs/superpowers/specs/2026-04-08-bibel-forsker-design.md` for full designspec med alternativer vi vurderte og forkastet.

## Datakilder

- [free-bible](https://github.com/flogvit/free-bible) — hebraisk/gresk kildetekst, norske oversettelser, ord-for-ord, kryssreferanser
- **DOAJ** — åpne fagfellevurderte artikler (direkte API)
- **IxTheo** — teologisk indeks (åpen)
- **Idunn** — norske akademiske tidsskrifter
- **Google Scholar** — åpne artikler
- **Wikipedia** — encyklopedisk bakgrunn

## Lisens

MIT
