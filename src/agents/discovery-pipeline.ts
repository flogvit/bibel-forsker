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

const REVIEW_PAPER_PROMPT = `Du er en akademisk fagfellevurderer innen bibelforskning. Vurder dette paperet.

Tittel: {{title}}

Paper:
{{paper}}

Teologisk vurdering fra tidligere gjennomgang:
{{theologicalReview}}

Vurder paperet kritisk:
1. Er argumentasjonen logisk sammenhengende?
2. Er evidensen tilstrekkelig for påstandene?
3. Er motargumenter tilstrekkelig behandlet?
4. Er metodikken transparent og reproduserbar?
5. Er referansene troverdige?
6. Er akademisk stil og nøyaktighet ivaretatt?

Svar med JSON:
\`\`\`json
{
  "verdict": "approve|revise|reject",
  "overallQuality": "high|adequate|low",
  "strengths": ["styrker"],
  "weaknesses": ["svakheter"],
  "requiredRevisions": ["spesifikke endringer som MÅ gjøres"],
  "suggestedImprovements": ["valgfrie forbedringer"]
}
\`\`\``;

const REFERENCE_CHECK_PROMPT = `Du er en referansesjekker for akademiske papers. Din jobb er å verifisere at ALLE referanser i paperet er ekte.

AI-systemer har en tendens til å FINNE OPP referanser som ser troverdige ut men ikke eksisterer. Dette er UAKSEPTABELT i akademisk arbeid.

Paper:
{{paper}}

For HVER referanse i paperet:
1. Søk på nettet (WebSearch) for å verifisere at boken/artikkelen FAKTISK eksisterer
2. Sjekk at forfatter, tittel, og årstall stemmer
3. Sjekk at innholdet referansen brukes til faktisk finnes i kilden

Svar med JSON:
\`\`\`json
{
  "references": [
    {
      "cited": "slik den er sitert i paperet",
      "verified": true/false,
      "exists": true/false,
      "correctAttribution": true/false,
      "notes": "hva du fant eller ikke fant"
    }
  ],
  "fabricatedCount": 0,
  "unverifiableCount": 0,
  "verdict": "all_verified|some_unverifiable|fabrications_found",
  "recommendations": ["hva som bør fjernes eller erstattes"]
}
\`\`\``;

const ORIGINALITY_CHECK_PROMPT = `Du er en plagiat- og originalitetssjekker for akademisk bibelforskning.

Tittel: {{title}}
Hovedpåstand: {{claim}}

Paper (forkortet):
{{paper}}

Din oppgave: Søk på nettet etter eksisterende forskning som fremmer LIGNENDE påstander eller argumenter.
Bruk WebSearch for å finne artikler, bøker, og publikasjoner som dekker samme tema.

Vurder:
1. Finnes det publisert forskning som allerede sier det samme?
2. Er våre formuleringer for like eksisterende tekster? (plagiat-risiko)
3. Hva er genuint nytt i vårt paper vs. eksisterende kunnskap?
4. Er det viktige kilder vi BURDE ha referert til men ikke har?

Svar med JSON:
\`\`\`json
{
  "originalityScore": 1-10,
  "similarWorks": [{"title": "string", "author": "string", "similarity": "identical|very_similar|similar_argument|related|tangential", "url": "string"}],
  "genuinelyNew": ["hva som faktisk er nytt i vårt paper"],
  "missingReferences": ["viktige kilder vi bør referere til"],
  "plagiarismRisk": "none|low|medium|high",
  "assessment": "oppsummering"
}
\`\`\``;

const REVISE_PAPER_PROMPT = `Du er en akademisk forfatter innen bibelforskning. Revider dette paperet basert på fagfellevurderingen.

Tittel: {{title}}

Nåværende paper:
{{paper}}

Fagfellevurdering:
{{review}}

Krav til revisjon:
{{requiredRevisions}}

Skriv det HELE paperet på nytt med revisjonene innarbeidet. Ikke skriv "endret seksjon X" — skriv hele paperet fra start til slutt.
Behold akademisk norsk stil. Vær ærlig om begrensninger.`;

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

  /**
   * Review papers that have been written and revise if needed
   */
  async reviewPapers(): Promise<void> {
    const papersToReview = await db
      .select()
      .from(discoveries)
      .where(
        sql`${discoveries.paperStatus} = 'draft' AND ${discoveries.paper} IS NOT NULL`,
      )
      .limit(3);

    for (const disc of papersToReview) {
      await this.reviewAndRevise(disc);
    }
  }

  private async reviewAndRevise(discovery: typeof discoveries.$inferSelect): Promise<void> {
    console.log(`Reviewing paper: "${discovery.title}"...`);

    // Step 1: Originality check — search online for similar work
    interface OriginalityResult {
      originalityScore: number;
      similarWorks: Array<{ title: string; author: string; similarity: string; url: string }>;
      genuinelyNew: string[];
      missingReferences: string[];
      plagiarismRisk: string;
      assessment: string;
    }

    try {
      const origPrompt = LLM.formatPrompt(ORIGINALITY_CHECK_PROMPT, {
        title: discovery.title,
        claim: discovery.claim,
        paper: (discovery.paper ?? '').slice(0, 4000),
      });

      const origResponse = await this.llm.callJSON<OriginalityResult>(origPrompt);
      const orig = origResponse.data;

      await db.insert(researchLog).values({
        eventType: 'originality_check',
        agentType: 'discovery-pipeline',
        details: {
          discoveryId: discovery.id,
          title: discovery.title,
          originalityScore: orig.originalityScore,
          plagiarismRisk: orig.plagiarismRisk,
          similarWorks: orig.similarWorks.length,
          genuinelyNew: orig.genuinelyNew,
        },
      });

      if (orig.plagiarismRisk === 'high' || orig.originalityScore <= 2) {
        console.log(`Paper failed originality check: "${discovery.title}" (score: ${orig.originalityScore}, risk: ${orig.plagiarismRisk})`);
        await db.update(discoveries)
          .set({
            paperStatus: 'failed_originality',
            status: 'not_novel',
            noveltyAssessment: `Originalitetssjekk: ${orig.assessment}. Lignende verk: ${orig.similarWorks.map(w => w.title).join(', ')}`,
            updatedAt: new Date(),
          })
          .where(eq(discoveries.id, discovery.id));
        return;
      }
    } catch (e) {
      console.error('Originality check failed (proceeding):', e instanceof Error ? e.message : e);
    }

    // Step 2: Reference verification — no fabricated references allowed
    interface RefCheckResult {
      references: Array<{ cited: string; verified: boolean; exists: boolean; correctAttribution: boolean; notes: string }>;
      fabricatedCount: number;
      unverifiableCount: number;
      verdict: string;
      recommendations: string[];
    }

    try {
      const refPrompt = LLM.formatPrompt(REFERENCE_CHECK_PROMPT, {
        paper: discovery.paper ?? '',
      });

      const refResponse = await this.llm.callJSON<RefCheckResult>(refPrompt);
      const refCheck = refResponse.data;

      await db.insert(researchLog).values({
        eventType: 'reference_check',
        agentType: 'discovery-pipeline',
        details: {
          discoveryId: discovery.id,
          title: discovery.title,
          totalRefs: refCheck.references.length,
          verified: refCheck.references.filter(r => r.verified).length,
          fabricated: refCheck.fabricatedCount,
          unverifiable: refCheck.unverifiableCount,
          verdict: refCheck.verdict,
        },
      });

      if (refCheck.fabricatedCount > 0) {
        console.log(`Found ${refCheck.fabricatedCount} fabricated references in "${discovery.title}" — revising to remove them`);

        // Rewrite paper without fabricated references
        const fabricatedRefs = refCheck.references
          .filter(r => !r.exists)
          .map(r => r.cited)
          .join('\n- ');

        const cleanPrompt = `Revider dette paperet. Fjern ALLE følgende referanser som er oppdiktet/ikke-eksisterende. Erstatt dem med referanser du VET eksisterer, eller fjern påstanden som avhenger av dem.

OPPDIKTEDE REFERANSER SOM MÅ FJERNES:
- ${fabricatedRefs}

Verifiserte referanser som kan beholdes:
${refCheck.references.filter(r => r.verified).map(r => '- ' + r.cited).join('\n')}

Anbefalinger fra referansesjekkeren:
${refCheck.recommendations.join('\n')}

Nåværende paper:
${discovery.paper}

Skriv HELE paperet på nytt. Vær ærlig — det er bedre å si "dette krever videre forskning" enn å bruke falske referanser.`;

        const cleanResponse = await this.llm.call(cleanPrompt);

        await db.update(discoveries)
          .set({
            paper: cleanResponse.text,
            paperStatus: 'draft',
            updatedAt: new Date(),
          })
          .where(eq(discoveries.id, discovery.id));

        await db.insert(researchLog).values({
          eventType: 'paper_references_cleaned',
          agentType: 'discovery-pipeline',
          details: {
            discoveryId: discovery.id,
            title: discovery.title,
            fabricatedRemoved: refCheck.fabricatedCount,
          },
        });
      }
    } catch (e) {
      console.error('Reference check failed (proceeding):', e instanceof Error ? e.message : e);
    }

    // Step 3: Academic peer review
    interface ReviewResult {
      verdict: string;
      overallQuality: string;
      strengths: string[];
      weaknesses: string[];
      requiredRevisions: string[];
      suggestedImprovements: string[];
    }

    // Review
    const reviewPrompt = LLM.formatPrompt(REVIEW_PAPER_PROMPT, {
      title: discovery.title,
      paper: (discovery.paper ?? '').slice(0, 8000),
      theologicalReview: JSON.stringify(discovery.theologicalReview, null, 2),
    });

    let review: ReviewResult;
    try {
      const response = await this.llm.callJSON<ReviewResult>(reviewPrompt);
      review = response.data;
    } catch (e) {
      console.error('Paper review failed:', e);
      return;
    }

    await db.insert(researchLog).values({
      eventType: 'paper_reviewed',
      agentType: 'discovery-pipeline',
      details: {
        discoveryId: discovery.id,
        title: discovery.title,
        verdict: review.verdict,
        quality: review.overallQuality,
        strengths: review.strengths.length,
        weaknesses: review.weaknesses.length,
        revisions: review.requiredRevisions.length,
      },
    });

    if (review.verdict === 'approve') {
      await db.update(discoveries)
        .set({ paperStatus: 'approved', updatedAt: new Date() })
        .where(eq(discoveries.id, discovery.id));
      console.log(`Paper approved: "${discovery.title}"`);
      return;
    }

    if (review.verdict === 'reject') {
      await db.update(discoveries)
        .set({ paperStatus: 'rejected', status: 'rejected', updatedAt: new Date() })
        .where(eq(discoveries.id, discovery.id));
      console.log(`Paper rejected: "${discovery.title}"`);
      return;
    }

    // Revise
    if (review.requiredRevisions.length === 0) {
      // Nothing specific to revise — approve
      await db.update(discoveries)
        .set({ paperStatus: 'approved', updatedAt: new Date() })
        .where(eq(discoveries.id, discovery.id));
      return;
    }

    console.log(`Revising paper: "${discovery.title}" (${review.requiredRevisions.length} revisions)...`);

    const revisePrompt = LLM.formatPrompt(REVISE_PAPER_PROMPT, {
      title: discovery.title,
      paper: discovery.paper ?? '',
      review: JSON.stringify(review, null, 2),
      requiredRevisions: review.requiredRevisions.join('\n- '),
    });

    try {
      const response = await this.llm.call(revisePrompt);

      await db.update(discoveries)
        .set({
          paper: response.text,
          paperStatus: 'revised',
          updatedAt: new Date(),
        })
        .where(eq(discoveries.id, discovery.id));

      await db.insert(researchLog).values({
        eventType: 'paper_revised',
        agentType: 'discovery-pipeline',
        details: {
          discoveryId: discovery.id,
          title: discovery.title,
          revisionsApplied: review.requiredRevisions.length,
          newLength: response.text.length,
        },
      });

      console.log(`Paper revised: "${discovery.title}" (${response.text.length} chars)`);
    } catch (e) {
      console.error('Paper revision failed:', e);
    }
  }
}
