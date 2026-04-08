import { db } from '../../db/connection.js';
import { library, researchLog, findings } from '../../db/schema.js';
import { searchDOAJ } from './doaj-api.js';
import { sql, desc } from 'drizzle-orm';
import { LLM } from '../../llm/llm.js';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

interface ScoutMaterial {
  url: string;
  title: string;
  content: string;
  contentType: string;
  author?: string;
  year?: number;
  relevance: string;
}

interface ScoutResult {
  materials: ScoutMaterial[];
}

abstract class BaseScout {
  abstract readonly name: string;
  abstract readonly prompt: string;
  protected llm: LLM;

  constructor(llm: LLM) {
    this.llm = llm;
  }

  async search(topics: string, searchTerm: string): Promise<number> {
    const existing = await db
      .select({ url: library.url })
      .from(library)
      .limit(200);
    const existingUrls = new Set(existing.map(e => e.url).filter(Boolean));

    console.log(`Scout [${this.name}]: "${searchTerm.slice(0, 50)}..."...`);

    const prompt = LLM.formatPrompt(this.prompt, { topics, searchTerm });

    try {
      const response = await this.llm.callJSON<ScoutResult>(prompt);
      let saved = 0;

      for (const mat of response.data.materials) {
        if (!mat.content || mat.content.length < 200) continue;
        if (mat.url && existingUrls.has(mat.url)) continue;

        await db.insert(library).values({
          url: mat.url || null,
          title: mat.title,
          content: mat.content,
          contentType: mat.contentType || 'article',
          author: mat.author || null,
          publicationYear: mat.year || null,
          status: 'raw',
        });
        saved++;
        if (mat.url) existingUrls.add(mat.url);
      }

      await db.insert(researchLog).values({
        eventType: 'scout_complete',
        agentType: `scout:${this.name}`,
        details: {
          source: this.name,
          searchTerm: searchTerm.slice(0, 80),
          materialsFound: response.data.materials.length,
          materialsSaved: saved,
        },
      });

      console.log(`Scout [${this.name}]: found ${response.data.materials.length}, saved ${saved}.`);
      return saved;
    } catch (e) {
      console.error(`Scout [${this.name}] failed:`, e instanceof Error ? e.message : e);
      await db.insert(researchLog).values({
        eventType: 'scout_failed',
        agentType: `scout:${this.name}`,
        details: { source: this.name, error: e instanceof Error ? e.message : String(e) },
      });
      return 0;
    }
  }
}

export class IxTheoScout extends BaseScout {
  readonly name = 'IxTheo';
  readonly prompt = `Du er en forsknings-scout. Søk i IxTheo (Index Theologicus) — en åpen teologisk database på https://ixtheo.de/

Søk etter: {{searchTerm}}

Bruk WebSearch med: site:ixtheo.de "{{searchTerm}}"
Prøv også: ixtheo.de Search for artikler om emnet.
Bruk WebFetch for å hente abstract/innhold fra artiklene du finner.

Svar med JSON:
\`\`\`json
{"materials": [{"url": "string", "title": "string", "content": "abstract eller tekst", "contentType": "article", "author": "forfatter", "year": 2020, "relevance": "kort"}]}
\`\`\``;
}

export class GoogleScholarScout extends BaseScout {
  readonly name = 'GoogleScholar';
  readonly prompt = `Du er en forsknings-scout. Søk i Google Scholar etter ÅPNE akademiske artikler.

Søk etter: {{searchTerm}}

Bruk WebSearch med:
- "{{searchTerm}}" biblical studies
- "{{searchTerm}}" Old Testament Hebrew

Prioriter resultater med [PDF] eller åpen tilgang. IKKE hent fra betalingsmurer.
Bruk WebFetch for å hente innhold fra åpne artikler.

Svar med JSON:
\`\`\`json
{"materials": [{"url": "string", "title": "string", "content": "teksten", "contentType": "article", "author": "forfatter", "year": 2020, "relevance": "kort"}]}
\`\`\``;
}

export class IdunnScout extends BaseScout {
  readonly name = 'Idunn';
  readonly prompt = `Du er en forsknings-scout. Søk i Idunn.no — plattformen for norske akademiske tidsskrifter.

Relevante tidsskrifter: Tidsskrift for Teologi og Kirke (TTK), Norsk Teologisk Tidsskrift (NTT).

Søk etter: {{searchTerm}}

Bruk WebSearch med: site:idunn.no "{{searchTerm}}"
Bruk WebFetch for å hente innhold. Mange artikler på Idunn er åpent tilgjengelige.

Svar med JSON:
\`\`\`json
{"materials": [{"url": "string", "title": "string", "content": "teksten", "contentType": "article", "author": "forfatter", "year": 2020, "relevance": "kort"}]}
\`\`\``;
}

export class WikipediaScout extends BaseScout {
  readonly name = 'Wikipedia';
  readonly prompt = `Du er en forsknings-scout. Hent Wikipedia-artikler relevante for bibelforskning.

Emne: {{searchTerm}}

Hent artikler fra Wikipedia (engelsk og norsk) om dette emnet.
Bruk WebFetch på Wikipedia-URLer direkte.
Hent FULLE artikler, ikke bare introen.

Svar med JSON:
\`\`\`json
{"materials": [{"url": "string", "title": "string", "content": "full tekst", "contentType": "encyclopedia", "author": "Wikipedia", "year": 2024, "relevance": "kort"}]}
\`\`\``;
}

export class DOAJScout extends BaseScout {
  readonly name = 'DOAJ';
  readonly prompt = `Du er en forsknings-scout. Søk i DOAJ (Directory of Open Access Journals) — kun åpne artikler.

Søk etter: {{searchTerm}}

Bruk WebSearch med: site:doaj.org "{{searchTerm}}" OR doaj.org biblical theology
Bruk WebFetch for å hente artikler.

Svar med JSON:
\`\`\`json
{"materials": [{"url": "string", "title": "string", "content": "teksten", "contentType": "article", "author": "forfatter", "year": 2020, "relevance": "kort"}]}
\`\`\``;
}

// All scouts in one place — Rektor picks which to run
export const ALL_SCOUTS = [IxTheoScout, GoogleScholarScout, IdunnScout, WikipediaScout, DOAJScout];

/**
 * Run all scouts in sequence. Returns total materials saved.
 */
export async function runAllScouts(llm: LLM): Promise<number> {
  // Get topics from strategy
  const strategyPath = resolve(process.cwd(), 'research/strategy.md');
  const strategy = existsSync(strategyPath) ? await readFile(strategyPath, 'utf-8') : '';
  const topicsMatch = strategy.match(/## (?:Prioriterte forskningsfronter|Aktive forskningsretninger)([\s\S]*?)(?=\n## |$)/);
  const topics = topicsMatch?.[1]?.trim() ?? 'bibelforskning hermeneutikk tekstkritikk';

  // Get search terms from topics and recent findings
  const topicLines = topics.split('\n').filter(l => l.trim().length > 5);
  const recentFindings = await db
    .select({ finding: findings.finding })
    .from(findings)
    .orderBy(desc(findings.createdAt))
    .limit(5);

  // Build diverse search terms
  const searchTerms: string[] = [];
  for (const line of topicLines) {
    const clean = line.replace(/^[-*\d.]+\s*/, '').replace(/\*\*/g, '').replace(/\(.*?\)/g, '').trim();
    if (clean.length > 5) searchTerms.push(clean.slice(0, 80));
  }
  // Add terms from recent findings
  for (const f of recentFindings) {
    const words = f.finding.split(/\s+/).slice(0, 8).join(' ');
    if (words.length > 10) searchTerms.push(words);
  }

  if (searchTerms.length === 0) searchTerms.push('biblical hermeneutics textual criticism');

  let totalSaved = 0;

  // Direct API scouts first (fast, no LLM cost)
  for (const term of searchTerms.slice(0, 3)) {
    try {
      totalSaved += await searchDOAJ(term);
    } catch (e) {
      console.error('DOAJ API error:', e instanceof Error ? e.message : e);
    }
  }

  // Then LLM-based scouts (slower, but can navigate complex sites)
  for (const ScoutClass of ALL_SCOUTS) {
    const scout = new ScoutClass(llm);
    // Pick a random search term for each scout
    const term = searchTerms[Math.floor(Math.random() * searchTerms.length)];
    try {
      const saved = await scout.search(topics.slice(0, 1000), term);
      totalSaved += saved;
    } catch (e) {
      console.error(`Scout [${scout.name}] error:`, e instanceof Error ? e.message : e);
    }
  }

  return totalSaved;
}
