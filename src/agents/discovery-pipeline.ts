import { db } from '../db/connection.js';
import { findings, discoveries, researchLog } from '../db/schema.js';
import { eq, desc, and, isNull, sql } from 'drizzle-orm';
import { LLM } from '../llm/llm.js';

const NOVELTY_CHECK_PROMPT = `Du er en akademisk forskningsassistent. Vurder om dette funnet fra vår bibelforskning potensielt er unikt eller nytt.

Funn:
{{finding}}

Evidensstyrke: {{evidenceStrength}}
Begrunnelse: {{reasoning}}

Vurder:
1. Er dette allerede velkjent i bibelforskning-feltet?
2. Presenterer det en ny vinkling, kobling eller innsikt?
3. Hvis nytt — hvor betydningsfullt er det?

Gi funnet en tittel (kort, presis).

Svar med JSON:
\`\`\`json
{
  "isNovel": true/false,
  "title": "kort tittel på funnet",
  "noveltyLevel": "known|incremental|significant|potentially_groundbreaking",
  "reasoning": "hvorfor dette er/ikke er nytt",
  "searchQueries": ["søkeord for å verifisere mot eksisterende forskning"]
}
\`\`\``;

const LITERATURE_SEARCH_PROMPT = `Du er en forskningsassistent som sjekker om et funn allerede er publisert.

Vårt funn:
Tittel: {{title}}
Påstand: {{claim}}

Søk på nettet etter eksisterende forskning som dekker dette. Bruk WebSearch og WebFetch for å finne relevante artikler, bøker, eller akademiske publikasjoner.

Svar med JSON:
\`\`\`json
{
  "existingResearch": [{"title": "string", "author": "string", "summary": "string", "url": "string", "relevance": "identical|similar|related|tangential"}],
  "conclusion": "already_published|partially_known|appears_novel",
  "summary": "oppsummering av hva som finnes"
}
\`\`\``;

const THEOLOGICAL_REVIEW_PROMPT = `Du er en teologisk fagfellevurderer. Vurder dette funnet mot gjeldende teologi og bibelforskning.

Tittel: {{title}}
Påstand: {{claim}}

Eksisterende forskning funnet:
{{existingResearch}}

Vurder:
1. Er dette i tråd med eller avviker fra gjeldende teologisk konsensus?
2. Hvis avvik — er det godt begrunnet?
3. Hvilke motargumenter finnes?
4. Er metodikken solid?

Svar med JSON:
\`\`\`json
{
  "alignment": "mainstream|nuanced|controversial|heterodox",
  "assessment": "detaljert vurdering",
  "counterarguments": ["mulige motargumenter"],
  "methodologicalStrength": "strong|adequate|weak",
  "recommendation": "publish|revise|further_research|reject"
}
\`\`\``;

const PAPER_PROMPT = `Du er en akademisk forfatter innen bibelforskning. Skriv en kort forskningsartikkel (avhandling) om dette funnet.

Tittel: {{title}}
Hovedpåstand: {{claim}}

Litteratursøk:
{{literatureSearch}}

Teologisk vurdering:
{{theologicalReview}}

Skriv artikkelen på norsk i akademisk stil. Inkluder:
1. Sammendrag (abstract)
2. Innledning med forskningsspørsmål
3. Metode
4. Analyse og funn
5. Diskusjon (inkluder motargumenter og begrensninger)
6. Konklusjon
7. Referanser (til det vi fant i litteratursøket)

Vær ærlig om begrensninger. Hvis funnet bygger på AI-analyse, si det eksplisitt.
Skriv som en ekte forsker — ikke overdriv, vær presis, anerkjenn usikkerhet.`;

interface NoveltyResult {
  isNovel: boolean;
  title: string;
  noveltyLevel: string;
  reasoning: string;
  searchQueries: string[];
}

interface LitSearchResult {
  existingResearch: Array<{ title: string; author: string; summary: string; url: string; relevance: string }>;
  conclusion: string;
  summary: string;
}

interface TheologicalResult {
  alignment: string;
  assessment: string;
  counterarguments: string[];
  methodologicalStrength: string;
  recommendation: string;
}

export class DiscoveryPipeline {
  private llm: LLM;

  constructor(llm: LLM) {
    this.llm = llm;
  }

  /**
   * Scan recent findings for potential discoveries
   */
  async scanForDiscoveries(): Promise<void> {
    // Find strong findings that haven't been evaluated yet
    const strongFindings = await db
      .select()
      .from(findings)
      .where(
        and(
          sql`${findings.evidenceStrength} IN ('strong_evidence', 'proven')`,
          sql`${findings.id} NOT IN (SELECT finding_id FROM discoveries)`,
        ),
      )
      .orderBy(desc(findings.createdAt))
      .limit(5);

    for (const finding of strongFindings) {
      await this.evaluateFinding(finding);
    }
  }

  private async evaluateFinding(finding: typeof findings.$inferSelect): Promise<void> {
    console.log(`Evaluating finding ${finding.id} for novelty...`);

    // Step 1: Novelty check
    const noveltyPrompt = LLM.formatPrompt(NOVELTY_CHECK_PROMPT, {
      finding: finding.finding,
      evidenceStrength: finding.evidenceStrength,
      reasoning: finding.reasoning,
    });

    let novelty: NoveltyResult;
    try {
      const response = await this.llm.callJSON<NoveltyResult>(noveltyPrompt);
      novelty = response.data;
    } catch (e) {
      console.error('Novelty check failed:', e);
      return;
    }

    if (!novelty.isNovel) {
      await db.insert(researchLog).values({
        eventType: 'novelty_rejected',
        details: { findingId: finding.id, title: novelty.title, reason: novelty.reasoning },
      });
      // Still create a discovery record so we don't re-check
      await db.insert(discoveries).values({
        findingId: finding.id,
        title: novelty.title,
        claim: finding.finding,
        evidenceStrength: finding.evidenceStrength,
        status: 'not_novel',
        noveltyAssessment: novelty.reasoning,
      });
      return;
    }

    // Create discovery with pending status
    const [discovery] = await db.insert(discoveries).values({
      findingId: finding.id,
      title: novelty.title,
      claim: finding.finding,
      evidenceStrength: finding.evidenceStrength,
      status: 'pending_verification',
      noveltyAssessment: novelty.reasoning,
    }).returning();

    await db.insert(researchLog).values({
      eventType: 'discovery_identified',
      details: {
        discoveryId: discovery.id,
        findingId: finding.id,
        title: novelty.title,
        noveltyLevel: novelty.noveltyLevel,
      },
    });

    console.log(`Discovery identified: "${novelty.title}" (${novelty.noveltyLevel})`);

    // Step 2: Literature search
    await this.searchLiterature(discovery);

    // Step 3: Theological review
    await this.theologicalReview(discovery);

    // Step 4: Write paper if recommended
    const updatedDiscovery = await db.select().from(discoveries).where(eq(discoveries.id, discovery.id)).limit(1);
    const theolReview = updatedDiscovery[0]?.theologicalReview as TheologicalResult | null;
    if (theolReview?.recommendation === 'publish' || theolReview?.recommendation === 'revise') {
      await this.writePaper(discovery);
    }
  }

  private async searchLiterature(discovery: typeof discoveries.$inferSelect): Promise<void> {
    console.log(`Searching literature for: "${discovery.title}"...`);

    const prompt = LLM.formatPrompt(LITERATURE_SEARCH_PROMPT, {
      title: discovery.title,
      claim: discovery.claim,
    });

    try {
      const response = await this.llm.callJSON<LitSearchResult>(prompt);

      await db.update(discoveries)
        .set({
          literatureSearch: response.data,
          status: response.data.conclusion === 'already_published' ? 'already_published' : 'pending_theological_review',
          updatedAt: new Date(),
        })
        .where(eq(discoveries.id, discovery.id));

      await db.insert(researchLog).values({
        eventType: 'literature_search_complete',
        details: {
          discoveryId: discovery.id,
          title: discovery.title,
          conclusion: response.data.conclusion,
          sourcesFound: response.data.existingResearch.length,
        },
      });
    } catch (e) {
      console.error('Literature search failed:', e);
      await db.update(discoveries)
        .set({ status: 'pending_theological_review', updatedAt: new Date() })
        .where(eq(discoveries.id, discovery.id));
    }
  }

  private async theologicalReview(discovery: typeof discoveries.$inferSelect): Promise<void> {
    console.log(`Theological review for: "${discovery.title}"...`);

    // Re-read to get literature search results
    const [current] = await db.select().from(discoveries).where(eq(discoveries.id, discovery.id));
    const litSearch = current.literatureSearch as LitSearchResult | null;

    const prompt = LLM.formatPrompt(THEOLOGICAL_REVIEW_PROMPT, {
      title: discovery.title,
      claim: discovery.claim,
      existingResearch: litSearch
        ? JSON.stringify(litSearch.existingResearch, null, 2)
        : '(ingen eksisterende forskning funnet)',
    });

    try {
      const response = await this.llm.callJSON<TheologicalResult>(prompt);

      await db.update(discoveries)
        .set({
          theologicalReview: response.data,
          status: response.data.recommendation === 'reject' ? 'rejected' : 'pending_paper',
          updatedAt: new Date(),
        })
        .where(eq(discoveries.id, discovery.id));

      await db.insert(researchLog).values({
        eventType: 'theological_review_complete',
        details: {
          discoveryId: discovery.id,
          title: discovery.title,
          alignment: response.data.alignment,
          recommendation: response.data.recommendation,
        },
      });
    } catch (e) {
      console.error('Theological review failed:', e);
    }
  }

  private async writePaper(discovery: typeof discoveries.$inferSelect): Promise<void> {
    console.log(`Writing paper for: "${discovery.title}"...`);

    const [current] = await db.select().from(discoveries).where(eq(discoveries.id, discovery.id));

    const prompt = LLM.formatPrompt(PAPER_PROMPT, {
      title: current.title,
      claim: current.claim,
      literatureSearch: JSON.stringify(current.literatureSearch, null, 2),
      theologicalReview: JSON.stringify(current.theologicalReview, null, 2),
    });

    try {
      const response = await this.llm.call(prompt);

      await db.update(discoveries)
        .set({
          paper: response.text,
          paperStatus: 'draft',
          status: 'paper_written',
          updatedAt: new Date(),
        })
        .where(eq(discoveries.id, discovery.id));

      await db.insert(researchLog).values({
        eventType: 'paper_written',
        details: {
          discoveryId: discovery.id,
          title: current.title,
          paperLength: response.text.length,
        },
      });

      console.log(`Paper written for: "${current.title}" (${response.text.length} chars)`);
    } catch (e) {
      console.error('Paper writing failed:', e);
    }
  }
}
