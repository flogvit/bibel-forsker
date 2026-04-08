import { db } from '../db/connection.js';
import { findings, discoveries, researchLog } from '../db/schema.js';
import { desc, sql } from 'drizzle-orm';
import { LLM } from '../llm/llm.js';

const CLUSTER_PROMPT = `Du er en forskningssyntese-agent. Din jobb er å se over alle funn og finne klynger av relaterte funn som sammen kan utgjøre en forskningsartikkel.

Alle funn så langt:
{{findings}}

Se etter:
1. Funn som handler om samme tema eller passasje fra ulike vinkler
2. Funn som bygger på hverandre (A fant X, B fant Y, sammen betyr det Z)
3. Funn som utfordrer eller bekrefter hverandre
4. Mønstre som ingen enkelt funn ser, men som fremvokser når man ser dem sammen

En klynge er MODEN for paper hvis:
- Den har 3+ relaterte funn
- Funnene har minst "indication" evidensstyrke
- Sammen danner de en sammenhengende argumentasjon
- Det er en tydelig tese som kan formuleres

VIKTIG: Ikke lag klynger av funn som bare er overfladisk relaterte. En klynge skal ha en TESE — en påstand som klyngen samlet kan underbygge.

Svar på norsk med JSON:
\`\`\`json
{
  "clusters": [
    {
      "title": "kort tittel på klyngen",
      "thesis": "den sentrale påstanden/tesen",
      "findingIds": [1, 2, 3],
      "maturity": "emerging|developing|mature",
      "reasoning": "hvorfor disse funnene hører sammen og hva de samlet viser",
      "gaps": ["hva som mangler for å gjøre klyngen sterkere"]
    }
  ],
  "suggestedTasks": [
    {"agentType": "string", "description": "string", "priority": 0}
  ]
}
\`\`\``;

interface Cluster {
  title: string;
  thesis: string;
  findingIds: number[];
  maturity: 'emerging' | 'developing' | 'mature';
  reasoning: string;
  gaps: string[];
}

interface SynthesisResult {
  clusters: Cluster[];
  suggestedTasks: Array<{ agentType: string; description: string; priority: number }>;
}

export class SynthesisAgent {
  private llm: LLM;

  constructor(llm: LLM) {
    this.llm = llm;
  }

  async synthesize(): Promise<SynthesisResult | null> {
    const allFindings = await db
      .select()
      .from(findings)
      .orderBy(desc(findings.createdAt))
      .limit(50);

    if (allFindings.length < 5) return null; // Too few findings to cluster

    const findingSummaries = allFindings.map(f =>
      `[Funn #${f.id}] [${f.evidenceStrength}] ${f.agentType}: ${f.finding}`
    ).join('\n\n');

    const prompt = LLM.formatPrompt(CLUSTER_PROMPT, {
      findings: findingSummaries,
    });

    try {
      const response = await this.llm.callJSON<SynthesisResult>(prompt);

      // Log clusters found
      for (const cluster of response.data.clusters) {
        await db.insert(researchLog).values({
          eventType: cluster.maturity === 'mature' ? 'cluster_mature' : 'cluster_found',
          agentType: 'synthesis',
          details: {
            title: cluster.title,
            thesis: cluster.thesis,
            findingIds: cluster.findingIds,
            maturity: cluster.maturity,
            gaps: cluster.gaps,
          },
        });
      }

      // Mature clusters → create discovery for paper writing
      for (const cluster of response.data.clusters.filter(c => c.maturity === 'mature')) {
        // Check if we already have a discovery with similar title
        const existing = await db.select().from(discoveries)
          .where(sql`${discoveries.title} ILIKE ${'%' + cluster.title.slice(0, 30) + '%'}`)
          .limit(1);

        if (existing.length === 0) {
          await db.insert(discoveries).values({
            findingId: cluster.findingIds[0],
            title: cluster.title,
            claim: cluster.thesis,
            evidenceStrength: 'strong_evidence',
            status: 'pending_verification',
            noveltyAssessment: cluster.reasoning,
          });

          console.log(`Mature cluster → discovery: "${cluster.title}"`);
        }
      }

      await db.insert(researchLog).values({
        eventType: 'synthesis_complete',
        agentType: 'synthesis',
        details: {
          clustersFound: response.data.clusters.length,
          matureClusters: response.data.clusters.filter(c => c.maturity === 'mature').length,
          suggestedTasks: response.data.suggestedTasks.length,
        },
      });

      return response.data;
    } catch (e) {
      console.error('Synthesis failed:', e instanceof Error ? e.message : e);
      return null;
    }
  }
}
