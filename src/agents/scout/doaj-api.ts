import { db } from '../../db/connection.js';
import { library, researchLog } from '../../db/schema.js';
import { sql } from 'drizzle-orm';

/**
 * Direct DOAJ API scout — no LLM needed.
 * DOAJ has a free, open REST API at https://doaj.org/api/
 * Paginates through all results, not just page 1.
 */

interface DOAJResult {
  bibjson: {
    title: string;
    abstract?: string;
    author?: Array<{ name: string }>;
    year?: string;
    journal?: { title: string };
    link?: Array<{ url: string; type: string }>;
    keywords?: string[];
    subject?: Array<{ term: string }>;
  };
}

interface DOAJResponse {
  results: DOAJResult[];
  total: number;
  page: number;
  pageSize: number;
}

async function fetchPage(searchTerm: string, page: number, pageSize = 10): Promise<DOAJResponse | null> {
  const encoded = encodeURIComponent(searchTerm);
  const url = `https://doaj.org/api/search/articles/${encoded}?page=${page}&pageSize=${pageSize}`;

  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return await response.json() as DOAJResponse;
  } catch {
    return null;
  }
}

async function saveArticle(bib: DOAJResult['bibjson'], projectId?: number): Promise<boolean> {
  if (!bib.abstract || bib.abstract.length < 50) return false;

  const articleUrl = bib.link?.find(l => l.type === 'fulltext')?.url
    ?? bib.link?.[0]?.url ?? null;

  // Check duplicate by URL
  if (articleUrl) {
    const [dup] = await db.select({ id: library.id })
      .from(library)
      .where(sql`${library.url} = ${articleUrl}`)
      .limit(1);
    if (dup) return false;
  }

  // Check duplicate by title
  const [dupTitle] = await db.select({ id: library.id })
    .from(library)
    .where(sql`${library.title} = ${bib.title}`)
    .limit(1);
  if (dupTitle) return false;

  await db.insert(library).values({
    url: articleUrl,
    title: bib.title,
    content: bib.abstract,
    contentType: 'article',
    author: bib.author?.map(a => a.name).join(', ') ?? null,
    publicationYear: bib.year ? parseInt(bib.year) : null,
    peerReviewed: 'yes',
    sourceCredibility: 'academic',
    projectId: projectId ?? null,
    status: 'raw',
  });

  return true;
}

/**
 * Search DOAJ for a single term, first page only.
 */
export async function searchDOAJ(searchTerm: string, projectId?: number): Promise<number> {
  const data = await fetchPage(searchTerm, 1);
  if (!data) return 0;

  let saved = 0;
  for (const result of data.results) {
    if (await saveArticle(result.bibjson, projectId)) saved++;
  }

  console.log(`DOAJ: "${searchTerm.slice(0, 50)}" → ${data.total} total, ${saved} new`);
  return saved;
}

/**
 * Exhaustive search — paginate through ALL results for a search term.
 * Use for bulk downloading when building the library.
 */
export async function searchDOAJAll(searchTerm: string, maxPages = 20, projectId?: number): Promise<number> {
  const firstPage = await fetchPage(searchTerm, 1);
  if (!firstPage || firstPage.total === 0) return 0;

  const totalPages = Math.min(maxPages, Math.ceil(firstPage.total / 10));
  let totalSaved = 0;

  // Save first page
  for (const result of firstPage.results) {
    if (await saveArticle(result.bibjson, projectId)) totalSaved++;
  }

  // Fetch remaining pages
  for (let page = 2; page <= totalPages; page++) {
    const data = await fetchPage(searchTerm, page);
    if (!data || data.results.length === 0) break;

    for (const result of data.results) {
      if (await saveArticle(result.bibjson, projectId)) totalSaved++;
    }

    await Bun.sleep(300); // Be nice to the API
  }

  if (totalSaved > 0) {
    await db.insert(researchLog).values({
      eventType: 'scout_complete',
      agentType: 'scout:DOAJ-API',
      details: {
        source: 'DOAJ-API',
        searchTerm,
        totalResults: firstPage.total,
        pagesSearched: totalPages,
        materialsSaved: totalSaved,
        projectId,
      },
    });
  }

  console.log(`DOAJ: "${searchTerm.slice(0, 50)}" → ${firstPage.total} total, ${totalPages} pages, ${totalSaved} new`);
  return totalSaved;
}

/**
 * Predefined comprehensive search terms for biblical studies.
 */
export const BIBLICAL_STUDIES_TERMS = [
  // General
  'biblical studies', 'biblical criticism', 'biblical interpretation', 'biblical theology',
  // Text criticism
  'textual criticism Bible', 'Dead Sea Scrolls', 'Septuagint', 'Masoretic text', 'biblical manuscripts', 'Qumran',
  // Methods
  'biblical hermeneutics', 'narrative criticism Bible', 'form criticism', 'source criticism pentateuch',
  'redaction criticism', 'rhetorical criticism Bible', 'canonical criticism', 'literary criticism Hebrew Bible',
  // OT
  'Genesis creation', 'Genesis theology', 'Pentateuch', 'documentary hypothesis', 'Psalms theology',
  'Psalms Hebrew poetry', 'Isaiah servant', 'Isaiah theology', 'prophetic literature', 'wisdom literature Bible',
  'covenant theology', 'Torah', 'Hebrew Bible theology',
  // NT
  'New Testament intertextuality', 'Gospels historical Jesus', 'Synoptic problem', 'Johannine theology',
  'Pauline theology', 'Hebrews epistle', 'Revelation apocalyptic', 'christology', 'soteriology atonement',
  // Specific topics
  'hesed covenant', 'creation theology', 'temple theology', 'sacrifice atonement', 'kingdom God',
  'eschatology Bible', 'resurrection theology',
  // Languages
  'biblical Hebrew linguistics', 'biblical Greek', 'Hebrew semantics', 'Aramaic Bible',
  // History
  'biblical archaeology', 'ancient Near East Bible', 'Second Temple Judaism', 'early Christianity', 'Hellenistic Judaism',
];

/**
 * Bulk download — run all predefined searches exhaustively.
 */
export async function bulkDownload(maxPagesPerTerm = 10): Promise<number> {
  let total = 0;
  console.log(`DOAJ bulk download: ${BIBLICAL_STUDIES_TERMS.length} terms, max ${maxPagesPerTerm} pages each...`);

  for (const term of BIBLICAL_STUDIES_TERMS) {
    total += await searchDOAJAll(term, maxPagesPerTerm);
    await Bun.sleep(500);
  }

  console.log(`DOAJ bulk download complete: ${total} new articles.`);
  return total;
}
