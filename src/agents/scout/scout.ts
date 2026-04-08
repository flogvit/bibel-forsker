import { db } from '../../db/connection.js';
import { library, researchLog } from '../../db/schema.js';
import { sql, desc } from 'drizzle-orm';
import { LLM } from '../../llm/llm.js';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const SCOUT_PROMPT = `Du er en forsknings-scout som finner akademisk materiale for et bibelforskning-system.

Gjeldende forskningsstrategi:
{{strategy}}

Aktive forskningsretninger vi trenger materiale om:
{{topics}}

Materiale vi allerede har (ikke last ned duplikater):
{{existing}}

Din oppgave: Søk på nettet etter relevant akademisk materiale. Bruk WebSearch og WebFetch.

Prioriter:
1. Wikipedia-artikler om bibelforskning-metoder og -konsepter (alltid tilgjengelig)
2. Åpne universitetspublikasjoner
3. Encyklopedi-artikler om bibelske temaer
4. Metodikk-ressurser

For hvert funn, hent innholdet (WebFetch) og returner det.

VIKTIG: Hent FAKTISK innhold, ikke bare titler. Vi trenger teksten for å lære av den.

Svar med JSON:
\`\`\`json
{
  "materials": [
    {
      "url": "string",
      "title": "string",
      "content": "den faktiske teksten du hentet",
      "contentType": "article|encyclopedia|methodology|book_chapter|manuscript_info",
      "relevance": "kort forklaring på hvorfor dette er relevant"
    }
  ]
}
\`\`\``;

interface ScoutResult {
  materials: Array<{
    url: string;
    title: string;
    content: string;
    contentType: string;
    relevance: string;
  }>;
}

export class Scout {
  private llm: LLM;

  constructor(llm: LLM) {
    this.llm = llm;
  }

  async search(): Promise<number> {
    // Read current strategy for context
    const strategyPath = resolve(process.cwd(), 'research/strategy.md');
    const strategy = existsSync(strategyPath) ? await readFile(strategyPath, 'utf-8') : '';

    // Extract active topics from strategy
    const topicsMatch = strategy.match(/## (?:Prioriterte forskningsfronter|Aktive forskningsretninger)([\s\S]*?)(?=\n## |$)/);
    const topics = topicsMatch?.[1]?.trim() ?? 'generell bibelforskning';

    // Get existing material titles to avoid duplicates
    const existing = await db
      .select({ title: library.title })
      .from(library)
      .limit(50);
    const existingTitles = existing.map(e => e.title).join(', ') || '(ingen)';

    const prompt = LLM.formatPrompt(SCOUT_PROMPT, {
      strategy: strategy.slice(0, 1500),
      topics,
      existing: existingTitles,
    });

    try {
      const response = await this.llm.callJSON<ScoutResult>(prompt);
      let saved = 0;

      for (const mat of response.data.materials) {
        if (!mat.content || mat.content.length < 100) continue; // Skip empty/tiny results

        // Check for duplicate URLs
        if (mat.url) {
          const [dup] = await db.select({ id: library.id })
            .from(library)
            .where(sql`${library.url} = ${mat.url}`)
            .limit(1);
          if (dup) continue;
        }

        await db.insert(library).values({
          url: mat.url || null,
          title: mat.title,
          content: mat.content,
          contentType: mat.contentType || 'article',
          status: 'raw',
        });
        saved++;
      }

      await db.insert(researchLog).values({
        eventType: 'scout_complete',
        agentType: 'scout',
        details: {
          materialsFound: response.data.materials.length,
          materialsSaved: saved,
          topics,
        },
      });

      console.log(`Scout: found ${response.data.materials.length}, saved ${saved} new materials.`);
      return saved;
    } catch (e) {
      console.error('Scout failed:', e instanceof Error ? e.message : e);
      await db.insert(researchLog).values({
        eventType: 'scout_failed',
        agentType: 'scout',
        details: { error: e instanceof Error ? e.message : String(e) },
      });
      return 0;
    }
  }
}
