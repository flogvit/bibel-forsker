# Bibel-Forsker: AI-drevet bibelforskning v0.0.1

## Visjon

Et autonomt forskningssystem som gjør det en bibelforsker gjør: leser, analyserer, tolker, bygger kompetanse, og produserer nye innsikter om Bibelen. Systemet starter som en "grunnfagsstudent" og bygger seg opp over tid — fra å lære forskningsmetodikk til å produsere akademisk output.

Systemet kjører kontinuerlig, stopper/starter når eieren vil, og rapporterer funn for kommentering. Feil er OK — vi lærer av dem.

---

## Inspirasjonskilder og hva vi tok fra dem

### aksjer-prosjektet (../aksjer/)
Et autonomt aksjehandelssystem med daglig syklus: crawling, analyse, beslutning, refleksjon, oppdaterte regler.

**Hva vi tok:**
- Persistent learning via en evolving rules-fil (trading-rules.md → research-rules.md)
- Tre signalkilder som veies sammen (ikke bare én modell)
- Kveldlig refleksjon: hva fungerte, hva feilet, oppdater regler
- Crawlere som kontinuerlig henter nye data
- Immutable event log — alt lagres med reasoning, aldri slettet

**Hva vi valgte bort:**
- Dagssyklus (morgen/kveld) — vi kjører kontinuerlig i stedet, reflekterer etter fullførte oppgaver
- Cron-basert scheduling — vi bruker event-loop

### flogvit-coder (../flogvit-coder/)
En selvforbedrende kode-agent med supervisor, label-drevet state machine, og tiered reasoning.

**Hva vi tok:**
- Supervisor-mønster: billig triage (Haiku) → dyr reasoning (Opus)
- Self-improve: systemet kan endre sin egen kode når det finner bedre måter
- State preservation: lagre alt til fil/database, kan stoppe/starte uten tap
- Template-baserte prompts med verdict-parsing
- Worktree-isolasjon: agenter jobber isolert uten å forstyrre hverandre

**Hva vi valgte bort:**
- GitHub Issues som kommunikasjonsprotokoll — vi rapporterer direkte til eieren via CLI/rapporter
- Label-drevet state machine — for rigid for forskning, vi trenger mer fleksibilitet

### Microsoft Ms. Pac-Man (Hybrid Reward Architecture)
150+ spesialiserte agenter der hver optimaliserer for én ting, med en top-agent som veier signaler etter intensitet.

**Hva vi tok:**
- Mange spesialiserte "egoistiske" agenter fremfor én generalist
- Top-agent (Aggregator) som veier funn etter styrke, ikke flertall
- Intensitetsbasert vekting — en agent som er veldig sikker på sitt funn teller mer enn mange som er litt sikre

**Hva vi vurderte:**
- 150 agenter er overkill for v0.0.1, men arkitekturen skal støtte vilkårlig mange
- Vi starter med 2-3 agenter og lar Rektor spinne opp flere etter behov

### DeepMind: AlphaGo → AlphaZero → AlphaFold

**Hva vi tok:**
- AlphaGo: Start med menneskelig kunnskap (pensum), deretter overgå den via self-play/self-improve
- AlphaGo: Policy + Value nettverk — én del foreslår hva som er verdt å utforske, én del evaluerer kvalitet
- AlphaZero: Tabula rasa-prinsippet — ikke lås oss til menneskelige metoder, vær åpen for at systemet finner bedre tilnærminger
- AlphaFold: Iterativ raffinering gjennom flere pass (= hermeneutisk sirkel)
- AlphaFold: Hybrid symbolsk + neural — kombiner mønstergjenkjenning med kjente regler/constraints
- AlphaFold: Attention på relasjoner mellom elementer — perfekt for intertekstualitet

**Refleksjon:**
AlphaZero lærte uten menneskelig kunnskap, men hadde klare spillregler. Bibelforskning har ikke like klare regler. Derfor starter vi med menneskelig kunnskap (AlphaGo-tilnærming) og beveger oss mot mer autonom utforskning over tid. Det er mulig systemet finner forskningsmetoder vi ikke har tenkt på — det er en feature, ikke en bug.

---

## Forskningsmetodikk vi bygger inn

### Generell forskning (Wikipedia: Research)
Timeglassmodellen:
1. Problemidentifikasjon og litteraturgjennomgang
2. Spesifisering av forskningsspørsmål
3. Konseptuelt rammeverk
4. Metodevalg
5. Datainnsamling og verifisering
6. Analyse og tolkning
7. Rapportering
8. Kommunikasjon

Viktig innsikt: dette er en iterativ prosess, ikke lineær.

### Den hermeneutiske sirkelen
- Schleiermacher: del ↔ helhet, gjentatte sirkelbevegelser
- Dilthey: mening er kontekstuell, krever historisk kunnskap
- Heidegger: vi har alltid fore-structures (forutantakelser) — vi må være bevisste på dem
- Gadamer: forståelse oppstår gjennom dialog, ikke isolert analyse

**Implikasjon for systemet:** Aggregatoren må eksplisitt implementere hermeneutisk sirkel — analysere deler, forstå helheten, gå tilbake til delene med ny forståelse, gjenta. Systemet må spore sine egne forutantakelser og utfordre dem.

### Bibelkritikk-metoder
Hver av disse kan bli en forsker-agent:

| Metode | Hva den gjør | Nøkkelspørsmål |
|--------|-------------|-----------------|
| Tekstkritikk | Sammenligner manuskripter for å finne opprinnelig tekst | Hva sa originalteksten? Hvilke varianter finnes? |
| Kildekritikk | Identifiserer underliggende kilder | Hvilke dokumenter ble kombinert? (JEDP etc.) |
| Formkritikk | Identifiserer litterære former og deres opprinnelse | Hva slags tekst er dette? Hvor kommer den fra? (Sitz im Leben) |
| Redaksjonskritikk | Analyserer redaktørenes arbeid | Hvordan formet redaktøren materialet? Hvilken teologi driver redigeringen? |
| Litterær kritikk | Narrativ og retorisk analyse | Hva er strukturen? Hvordan brukes språket? |
| Historisk kritikk | Rekonstruerer historisk kontekst | Hva skjedde? Hva er den historiske bakgrunnen? |

### Grounded Theory
Bottom-up teoridannelse som lar mønstre emerge fra data:
1. Åpen koding — identifiser konsepter i teksten
2. Aksial koding — finn relasjoner mellom konseptene
3. Selektiv koding — fokuser på kjernefunn

**Hvorfor dette er viktig:** Tradisjonell bibelforskning starter ofte med en hypotese. Grounded Theory lar oss finne mønstre vi ikke lette etter. En Grounded Theory-agent som koder tekst systematisk kan oppdage sammenhenger ingen har sett.

### Systematiske reviews (PRISMA)
Formell prosess for å gjennomgå litteratur:
- Protokoll før søk (unngå bias)
- Inklusjons/eksklusjonskriterier
- Systematisk søk med dokumentert strategi
- Kvalitetsvurdering av kilder
- Sporbarhet gjennom hele prosessen

**Implikasjon:** Pensum-agentene må ikke bare "lese vilkårlig" — de trenger en review-protokoll.

### Triangulering
Et funn er ikke sterkt før det er bekreftet fra flere uavhengige retninger:
- Data-triangulering: samme spørsmål, ulike kilder (hebraisk, gresk, arameisk, oversettelser)
- Metode-triangulering: samme spørsmål, ulike metoder (lingvistisk + historisk + litterær)
- Teori-triangulering: samme funn, ulike tolkningsrammer

**Implikasjon:** Evaluator krever triangulering før et funn får høy evidensgradering.

---

## Arkitektur

```
┌─────────────────────────────────────────────────────────────┐
│                     EIER (Principal Investigator)            │
│         Kommenterer funn, setter retning, start/stopp       │
├─────────────────────────────────────────────────────────────┤
│                     REKTOR (Orchestrator)                    │
│  - Kontinuerlig event-loop                                  │
│  - Graceful shutdown/restart med state preservation          │
│  - Oppdaterer research-rules.md etter hver refleksjon       │
│  - Self-improve: endrer egen kode og agentoppsett           │
│  - Velger modell per oppgave: Ollama/Claude/egne            │
├──────────┬──────────┬──────────┬──────────┬────────────────┤
│ PENSUM   │ FORSKER  │ EVALUATOR│ SCOUT    │ AGGREGATOR     │
│ AGENTER  │ AGENTER  │          │ AGENTER  │                │
│          │          │          │          │                │
│ Metodikk │ Lingvist │ Policy:  │ Akademia │ Veier funn     │
│ Artikler │ Intertxt │ "verdt å │ Nye data │ etter evidens  │
│ Kompet.  │ Historisk│ utforske"│ Metoder  │                │
│ evaluator│ Hermenut │ Value:   │ AI/ML    │ Hermeneutisk   │
│          │ Kildekr. │ "hvor    │ teknikker│ sirkel         │
│          │ Formkr.  │ sterk    │          │                │
│          │ Redaksj. │ evidens?"│          │ Triangulering  │
│          │ Narrativ │          │          │                │
│          │ Grounded │ Bias-    │          │                │
│          │ Theory   │ sjekk    │          │                │
│          │ ...nye   │          │          │                │
├──────────┴──────────┴──────────┴──────────┴────────────────┤
│                    MODELL-LAG                                │
│  Claude API    │ Ollama (lokal) │ Egne ML-modeller          │
│  (tung reason.)│ (bulk-analyse) │ (spesialiserte)           │
│  Embeddings    │ Fine-tuned     │ Klassifiserere            │
├─────────────────────────────────────────────────────────────┤
│                    KUNNSKAPSBASE                             │
│  PostgreSQL        │ Neo4j           │ Vektordb (lokal)     │
│  (fakta, state,    │ (relasjoner:    │ (embeddings,         │
│   metadata,        │  tekst↔tekst,   │  semantisk søk)      │
│   oppgavekø,       │  konsept↔kons., │                      │
│   historikk)       │  person↔sted)   │ Filsystem            │
│                    │                 │ (artikler, bilder,    │
│                    │                 │  modeller, rådata)    │
└─────────────────────────────────────────────────────────────┘
```

### Agenttyper

#### Pensum-agenter (kompetansebygging — kjører alltid)
- **Metodikk-leser**: Laster ned og prosesserer akademisk materiale om forskningsmetodikk, hermeneutikk, tekstkritikk. Bruker systematisk review-protokoll (PRISMA-inspirert).
- **Artikkel-leser**: Finner og leser bibelforskning-artikler fra åpne kilder. Dokumenterer inklusjons/eksklusjonskriterier. Full sporbarhet.
- **Kompetanse-evaluator**: Tester systemets forståelse av det som er lært. Identifiserer kunnskapshull. Foreslår hva som bør læres neste.

#### Forsker-agenter (spinnes opp etter behov)
Hver agent er spesialisert og "egoistisk" (Ms. Pac-Man-prinsippet) — optimaliserer for sin ene ting:

- **Lingvist**: Hebraisk/gresk ordanalyse, etymologi, semantiske felt
- **Intertekstuell**: Koblinger mellom tekster, sitater, allusjoner, tematiske paralleller
- **Historisk**: Arkeologisk og historisk kontekst, datering
- **Hermeneutisk**: Tolkningsrammeverk, teologisk analyse
- **Kildekritisk**: Manuskriptvarianter, teksttradisjon (inkl. dødehavsruller)
- **Formkritisk**: Litterære former, Sitz im Leben, sjangre
- **Redaksjonskritisk**: Redaktørenes teologi og komposisjonsstrategi
- **Narrativ/litterær**: Struktur, retorikk, poetisk analyse
- **Grounded Theory-agent**: Systematisk bottom-up koding, lar mønstre emerge fra data
- **Nye agenter**: Rektor kan opprette nye typer når behovet oppstår

#### Evaluator (kvalitetssikring)
- **Policy**: "Er denne forskningsretningen verdt å fortsette?" (basert på funn så langt, ressursbruk, potensiale)
- **Value**: "Hvor sterk er evidensen?" (gradering: spekulasjon → indikasjon → sterk evidens → bevist)
- **Triangulering**: Krever bekreftelse fra minst 2 uavhengige metoder/kilder før høy gradering
- **Bias-sjekk**: Sporer forutantakelser (Heideggers fore-structures), utfordrer dem aktivt

#### Scout-agenter (omverdensovervåkning — kjører alltid)
- **Akademisk scout**: Overvåker nye publikasjoner, preprints, konferanser innen bibelforskning
- **Metode-scout**: Ser etter nye AI/ML-teknikker vi kan bruke
- **Data-scout**: Finner nye datakilder — digitaliserte manuskripter, nye oversettelser, arkeologiske funn

#### Aggregator (syntese)
- Samler funn fra alle forsker-agenter
- Veier etter evidensstyrke og agentens "intensitet" (Ms. Pac-Man), ikke flertall
- Implementerer hermeneutisk sirkel: del → helhet → del → helhet, gjentatt
- Produserer sammenhengende forskningsrapporter

### Rektor (Orchestrator)
- Kontinuerlig event-loop, ikke cron
- Leser research-rules.md for å styre strategi
- Reflekterer etter fullførte oppgaver/batches: hva fungerte, hva feilet, oppdater regler
- Self-improve: kan endre egen kode og agentoppsett
- Modell-routing: velger riktig modell per oppgave (Claude for tung reasoning, Ollama for bulk, egne modeller for spesialisert)
- Graceful shutdown/restart — all state i database

### Kommunikasjon med eier
```bash
bibel-forsker start              # start alle agenter
bibel-forsker stop               # graceful shutdown, lagrer all state
bibel-forsker status             # hva kjører, hva er i kø
bibel-forsker report             # siste funn og status
bibel-forsker comment "..."      # kommentar på funn
bibel-forsker focus "tema"       # prioriter et forskningsområde
bibel-forsker pause agents       # pause agenter, behold state
bibel-forsker resume             # gjenoppta
```

---

## Kunnskapsbase

### PostgreSQL
- Forskningsfunn med evidensgradering og reasoning
- Agent-state for stop/start
- Oppgavekø og historikk
- Pensum: artikler lest, metoder lært, kompetansevurderinger
- Immutable event log (som aksjer): alt lagres, aldri slettet

### Neo4j (når vi trenger det)
- Tekst → tekst (intertekstuelle koblinger)
- Konsept → konsept (teologiske sammenhenger)
- Person → hendelse → sted → tid
- Metode → funn → evidens
- Bok → forfatter → periode → tradisjon

### Vektordatabase (ChromaDB eller lignende, lokal)
- Embeddings av bibeltekst, artikler, funn
- Semantisk søk: "finn alt som ligner på dette konseptet"
- Lokal — ingen avhengighet av eksterne tjenester

### Filsystem
- Rådata: artikler, bilder av manuskripter, dødehavsruller
- Modeller: Ollama-modeller, egne ML-modeller
- research-rules.md (evolving strategi)
- Forskningsrapporter og papers

---

## Modell-lag

### Claude API
Tung reasoning, syntese, paper-skriving. Brukes når kvalitet er viktigere enn hastighet/kostnad.

### Ollama (lokal)
Bulk-analyse, koding av tekst, rask klassifisering. Kjører hele tiden uten API-kostnader. Systemet skal kunne laste ned og bruke modeller via Ollama.

### Egne ML-modeller
Trenes etter behov. Eksempler:
- Intertekstualitets-detektor (gjenkjenner allusjoner og sitater)
- Litterær form-klassifiserer (identifiserer sjangre og former)
- Tematisk klustrer (grupperer tekster etter tema)

### Fine-tuned modeller
Mulighet for å fine-tune eksisterende modeller på bibelspesifikke data.

### Embeddings
Lokal embedding-modell for vektordatabasen. Brukes til semantisk søk og klusteranalyse.

### Modell-routing
Rektor velger modell per oppgave:
- Er dette bulk-analyse? → Ollama
- Er dette tung reasoning? → Claude
- Har vi en spesialisert modell for dette? → Egen modell
- Trenger vi ny kompetanse? → Tren ny modell

---

## v0.0.1 Scope

Første versjon inneholder kun det minimale for å komme i gang:

1. **Rektor** — enkel event-loop, graceful start/stop, state i PostgreSQL
2. **Én pensum-agent** — laster ned og prosesserer forskningsmetodikk fra åpne akademiske kilder
3. **Én forsker-agent** — lingvistisk analyse med free-bible data som kilde
4. **research-rules.md** — starter nesten tom, vokser over tid
5. **Enkel CLI** — start/stop/status/report
6. **Ollama-integrasjon** — for lokal kjøring uten API-kostnader
7. **PostgreSQL** — grunnleggende schema for state, funn, og historikk

### Eksplisitt utenfor v0.0.1
| Hva | Hvorfor utsatt | Når |
|-----|----------------|-----|
| Neo4j | Trenger det ikke før vi har nok relasjonsdata | Når forsker-agenter produserer koblinger |
| Vektordatabase | Trenger det ikke før vi har nok tekst å søke i | Når pensum-agenten har lest nok materiale |
| Egne ML-modeller | Trenger treningsdata først | Når vi har identifisert spesifikke oppgaver som trenger det |
| Fine-tuning | Dyrt og trenger klart definert behov | Når Ollama/Claude ikke er gode nok for en spesifikk oppgave |
| Flere forsker-agenter | Starter med lingvist, utvider etter behov | Når Rektor identifiserer behov for ny kompetanse |
| Flere scout-agenter | Trenger grunninfrastruktur først | Etter v0.0.1 er stabil |
| Triangulering i Evaluator | Trenger minst 2 aktive forsker-agenter | Når vi har flere aktive forskningsretninger |
| Paper-generering | Trenger funn å skrive om | Når vi har substansielle resultater |
| Self-improve | Trenger stabil kodebase å forbedre | Etter v0.0.1 har kjørt en stund |
| Aggregator | Trenger flere agenter å aggregere | Når 3+ forsker-agenter er aktive |
| Hermeneutisk sirkel i Aggregator | Trenger aggregator først | Etter aggregator er implementert |

---

## Åpne spørsmål og tanker

### Ting vi ikke vet ennå
- **Hvor godt fungerer LLM-er som forskere?** Vi vet de er gode på analyse, men kan de faktisk oppdage noe nytt? Det er et av hovedspørsmålene prosjektet skal svare på.
- **Hva er riktig granularitet for agenter?** Ms. Pac-Man hadde 150, men kanskje vi trenger 5 eller kanskje 500. Vi itererer.
- **Hvordan måler vi forskningskvalitet?** Triangulering og evidensgradering er en start, men vi trenger bedre metrikker over tid.
- **Kan systemet virkelig self-improve meningfullt?** flogvit-coder gjør det for kode, men forskningsmetodikk er vagere.

### Alternative tilnærminger vi vurderte
- **Tilnærming B: "Doktorgradsstudenten"** — én sekvensiell agent i stedet for mange parallelle. Enklere men skalerer dårligere. Valgt bort fordi Ms. Pac-Man og AlphaGo viste at parallelle spesialister slår generalister.
- **Tilnærming C: "Swarm"** — kaotisk utforskning med naturlig seleksjon. Kreativt men for vanskelig å styre og evaluere tidlig. Kanskje aktuelt for en fremtidig "eksperimentell modus".
- **Dagssyklus vs. kontinuerlig** — aksjer bruker morgen/kveld, men det er fordi markedet har åpningstider. Forskning har det ikke.
- **GitHub Issues for kommunikasjon** — som flogvit-coder. Valgt bort til fordel for direkte CLI/rapporter fordi det er enklere og raskere feedback-loop.

### Ting vi tror vil endre seg
- Modell-landskapet endrer seg raskt. Claude og Ollama-modeller blir bedre. Vi designer for at systemet kan utnytte bedre modeller uten omskriving.
- Vi vil sannsynligvis oppdage forskningsmetoder underveis som vi ikke har tenkt på. Systemet må kunne adoptere dem.
- v0.0.1 er bevisst minimalt. De fleste komponentene i arkitekturen over vil komme i fremtidige versjoner, drevet av faktiske behov.

### Filosofiske betraktninger
- **Er AI-forskning "ekte" forskning?** Vi tar utgangspunkt i at det kan bli det, men med ydmykhet. Systemet skal ikke bare reprodusere eksisterende kunnskap — det skal prøve å finne noe nytt.
- **Heideggers fore-structures:** Alle LLM-er har innebygde bias fra trening. Vi må aktivt spore og utfordre disse. En LLM trent på vestlig teologi vil ha en bias — det er ikke en feil, men vi må vite om det.
- **Gadamers dialog:** Kanskje den mest interessante ideen. Kan vi få agenter til å ha ekte dialog med hverandre, ikke bare rapportere funn? Aggregatoren som dialog-fasilitator i stedet for bare en oppsummerer.

---

## Relasjon til andre prosjekter

### free-bible (../free-bible/)
- **Datakilde**: Oversettelser, ord-for-ord, kryssreferanser, kontekst, personnavn
- **Ikke avhengighet**: bibel-forsker leser fra free-bible men skriver ikke tilbake automatisk
- **Fremtidig synergi**: Funn fra forskning kan forbedre oversettelser og innhold i free-bible

### aksjer (../aksjer/)
- **Arkitektur-inspirasjon**: Daglig syklus, persistent learning, crawlere, immutable log
- **Ingen kobling**: Helt separate prosjekter

### flogvit-coder (../flogvit-coder/)
- **Arkitektur-inspirasjon**: Supervisor-mønster, self-improve, state preservation
- **Mulig verktøy**: Kan potensielt brukes til å implementere self-improve i bibel-forsker
