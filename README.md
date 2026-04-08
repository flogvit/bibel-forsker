# Bibel-Forsker

Et autonomt AI-system som forsker på Bibelen slik en menneskelig forsker ville gjort — samler eksisterende forskning, bygger kompetanse, identifiserer hull i kunnskapen, analyserer tekster, og produserer forskningsartikler.

## Prinsipper

1. **Last ned først, forsk etterpå.** Systemet laster ned all tilgjengelig forskning fra akademiske kilder før det begynner å forske selv.
2. **Ikke gjenoppfinn hjulet.** Alle funn sjekkes mot eksisterende forskning. Vi forsker kun på det som faktisk er uutforsket.
3. **Kildeagenter er autonome.** Hver kildeagent laster ned ALT fra sin kilde. Ikke de 10 siste, ikke --pages 50 — alt.
4. **Prosjekter følger akademisk flyt.** Litteratursøk → gjennomgang → identifiser hull → forsk → skriv paper.

## Agenter

### Kildeagenter (laster ned)
- **DOAJ** — henter alle tilgjengelige artikler fra Directory of Open Access Journals
- **Fulltekst-henter** — følger URL-er og henter selve artikkelen (ikke bare abstract)
- **Katalogiserer** — klassifiserer, tagger, vurderer troverdighet, genererer embeddings

### Forsker-agenter
- **Lingvist** — analyserer hebraisk/gresk originaltekst
- **Metodikk-leser** — studerer forskningsmetodikk

### Kvalitetssikring
- **Triage** — splitter for brede oppgaver
- **Reviewer** — validerer funn
- **Supervisor** — overvåker systemhelse

### Syntese
- **Syntese-agent** — finner klynger av relaterte funn
- **Discovery pipeline** — novelty check → litteratursøk → teologisk review → paper → originalitetssjekk → referansesjekk → fagfellevurdering

## Dashboard

Live web-dashboard på http://localhost:3051

- **Forskning** — status, agenter, oppgavekø, funn, forskningslogg
- **Papers & oppdagelser** — forskningsartikler, klynger, oppdagelser
- **Bibliotek** — ~10K akademiske artikler, fulltekstsøk, semantisk søk (RAG)
- **System** — forskningskunnskap, metoder, agentinstrukser

## Hurtigstart

### Forutsetninger

- [Bun](https://bun.sh)
- PostgreSQL med pgvector
- [Claude Code](https://claude.ai/code) CLI
- Ollama med nomic-embed-text (for embeddings) og gemma3:27b (for fulltekst-henting)

### Oppsett

```bash
bun install

# Database
psql -U postgres -c "CREATE DATABASE bibel_forsker;"
psql -U postgres -d bibel_forsker -c "CREATE EXTENSION IF NOT EXISTS vector;"

# Konfigurer
cp .env.example .env

# Migrasjoner
bun run db:migrate

# Ollama-modeller
ollama pull nomic-embed-text
ollama pull gemma3:27b

# Installer som global kommando
bun link
```

### Kjøring

```bash
# Start dispatcher
bibel-forsker start

# Start dashboard
bibel-forsker web

# Sjekk status
bibel-forsker status
bibel-forsker report

# Stopp
bibel-forsker stop
```

## Forskningsprosjekter

Opprett prosjekter via dashboardet (http://localhost:3051/projects).

Hvert prosjekt følger fasene:
1. **Litteratursøk** — laster ned alt som finnes om temaet
2. **Litteraturgjennomgang** — oppsummerer eksisterende forskning
3. **Identifiser hull** — hva er IKKE forsket på?
4. **Forskning** — analyserer kun hullene
5. **Paper** — skriver artikkel med fokus på nye bidrag

## Kildeagent-konfigurasjon

Kildeagenter konfigureres i `research/sources/`:

```json
// research/sources/doaj.json
{
  "searchTerms": ["biblical studies", "textual criticism Bible", ...]
}
```

Agenten leser søketermene og laster ned alt som matcher.

## Forskningskunnskap

```
research/
├── strategy.md            # Overordnet strategi (oppdateres manuelt)
├── sources/
│   └── doaj.json          # DOAJ søketermer
├── methods/               # Forskningsmetoder
│   ├── hermeneutics.md
│   ├── textual-criticism.md
│   ├── grounded-theory.md
│   ├── source-criticism.md
│   ├── narrative-criticism.md
│   └── intertextual-analysis.md
└── agents/                # Agentinstrukser
    ├── linguist.md
    └── methodology-reader.md
```

## Tech stack

- **Bun** — runtime, test, package manager
- **PostgreSQL** + pgvector — database, embeddings, RAG
- **Drizzle ORM** — type-safe database
- **Claude Code CLI** — LLM-reasoning via `claude -p`
- **Ollama** — embeddings (nomic-embed-text), fulltekst-navigering (gemma3:27b)

## Datakilder

- [free-bible](https://github.com/flogvit/free-bible) — hebraisk/gresk kildetekst, norske oversettelser
- **DOAJ** — ~10K åpne fagfellevurderte artikler

## Inspirasjonskilder

- **aksjer autotrader** — daglige læringssykluser, persistent strategi
- **flogvit-coder** — supervisor, self-improvement, rate limit
- **Ms. Pac-Man (Microsoft)** — spesialiserte parallelle agenter
- **DeepMind AlphaGo/AlphaFold** — iterativ raffinering

Se `docs/superpowers/specs/2026-04-08-bibel-forsker-design.md` for full designspec.

## Lisens

MIT
