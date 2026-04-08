import { db } from '../../db/connection.js';
import { library, researchLog } from '../../db/schema.js';
import { sql } from 'drizzle-orm';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * DOAJ source agent.
 * Downloads ALL available articles from DOAJ matching configured search terms.
 * Reads search terms from research/sources/doaj.json.
 * Paginates until there's nothing left. Deduplicates against database.
 */

const CONFIG_PATH = resolve(process.cwd(), 'research/sources/doaj.json');
const API_BASE = 'https://doaj.org/api/search/articles';
const PAGE_SIZE = 10;
const DELAY_MS = 500; // Be nice to the API

interface DOAJConfig {
  searchTerms: string[];
}

interface DOAJArticle {
  bibjson: {
    title: string;
    abstract?: string;
    author?: Array<{ name: string }>;
    year?: string;
    journal?: { title: string };
    link?: Array<{ url: string; type: string }>;
    keywords?: string[];
  };
}

async function loadConfig(): Promise<DOAJConfig> {
  if (!existsSync(CONFIG_PATH)) {
    throw new Error(`DOAJ config not found: ${CONFIG_PATH}. Create it with search terms.`);
  }
  return JSON.parse(await readFile(CONFIG_PATH, 'utf-8'));
}

async function isDuplicate(title: string, url: string | null): Promise<boolean> {
  if (url) {
    const [dup] = await db.select({ id: library.id })
      .from(library).where(sql`${library.url} = ${url}`).limit(1);
    if (dup) return true;
  }
  const [dup] = await db.select({ id: library.id })
    .from(library).where(sql`${library.title} = ${title}`).limit(1);
  return !!dup;
}

export async function downloadTerm(term: string): Promise<number> {
  let page = 1;
  let saved = 0;
  let total = 0;

  while (true) {
    const url = `${API_BASE}/${encodeURIComponent(term)}?page=${page}&pageSize=${PAGE_SIZE}`;
    let data: { results: DOAJArticle[]; total: number };

    try {
      const response = await fetch(url);
      if (!response.ok) break;
      data = await response.json() as typeof data;
    } catch {
      break;
    }

    if (page === 1) total = data.total;
    if (data.results.length === 0) break;

    for (const article of data.results) {
      const bib = article.bibjson;
      if (!bib.abstract || bib.abstract.length < 50) continue;

      const articleUrl = bib.link?.find(l => l.type === 'fulltext')?.url
        ?? bib.link?.[0]?.url ?? null;

      if (await isDuplicate(bib.title, articleUrl)) continue;

      await db.insert(library).values({
        url: articleUrl,
        title: bib.title,
        content: bib.abstract,
        contentType: 'article',
        author: bib.author?.map(a => a.name).join(', ') ?? null,
        publicationYear: bib.year ? parseInt(bib.year) : null,
        peerReviewed: 'yes',
        sourceCredibility: 'academic',
        status: 'raw',
      });
      saved++;
    }

    // Are there more pages?
    if (page * PAGE_SIZE >= data.total) break;
    page++;
    await Bun.sleep(DELAY_MS);
  }

  if (saved > 0) {
    console.log(`  DOAJ "${term}" — ${total} total, ${saved} new`);
  }

  return saved;
}

/**
 * Run the DOAJ agent. Downloads everything.
 */
export async function run(): Promise<void> {
  const config = await loadConfig();
  let totalSaved = 0;

  console.log(`DOAJ agent: ${config.searchTerms.length} search terms`);

  for (const term of config.searchTerms) {
    totalSaved += await downloadTerm(term);
  }

  await db.insert(researchLog).values({
    eventType: 'source_download_complete',
    agentType: 'source:doaj',
    details: {
      source: 'doaj',
      searchTerms: config.searchTerms.length,
      totalSaved,
    },
  });

  console.log(`DOAJ agent done: ${totalSaved} new articles.`);
}
