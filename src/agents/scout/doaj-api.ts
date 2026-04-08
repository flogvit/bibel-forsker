import { db } from '../../db/connection.js';
import { library, researchLog } from '../../db/schema.js';
import { sql } from 'drizzle-orm';

/**
 * Direct DOAJ API scout — no LLM needed.
 * DOAJ has a free, open REST API at https://doaj.org/api/
 */
export async function searchDOAJ(searchTerm: string): Promise<number> {
  const encoded = encodeURIComponent(searchTerm);
  const url = `https://doaj.org/api/search/articles/${encoded}?page=1&pageSize=10`;

  console.log(`DOAJ API: searching "${searchTerm.slice(0, 50)}"...`);

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`DOAJ API error: ${response.status}`);
      return 0;
    }

    const data = await response.json() as {
      results: Array<{
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
      }>;
      total: number;
    };

    let saved = 0;

    for (const result of data.results) {
      const bib = result.bibjson;
      if (!bib.abstract || bib.abstract.length < 50) continue;

      const articleUrl = bib.link?.find(l => l.type === 'fulltext')?.url
        ?? bib.link?.[0]?.url ?? null;

      // Check duplicate
      if (articleUrl) {
        const [dup] = await db.select({ id: library.id })
          .from(library)
          .where(sql`${library.url} = ${articleUrl}`)
          .limit(1);
        if (dup) continue;
      }

      const authors = bib.author?.map(a => a.name).join(', ') ?? null;

      await db.insert(library).values({
        url: articleUrl,
        title: bib.title,
        content: bib.abstract,
        contentType: 'article',
        author: authors,
        publicationYear: bib.year ? parseInt(bib.year) : null,
        peerReviewed: 'yes', // DOAJ only indexes peer-reviewed open access
        sourceCredibility: 'academic',
        status: 'raw',
      });
      saved++;
    }

    await db.insert(researchLog).values({
      eventType: 'scout_complete',
      agentType: 'scout:DOAJ-API',
      details: {
        source: 'DOAJ-API',
        searchTerm,
        totalResults: data.total,
        materialsFound: data.results.length,
        materialsSaved: saved,
      },
    });

    console.log(`DOAJ API: ${data.total} total, ${data.results.length} returned, ${saved} saved.`);
    return saved;
  } catch (e) {
    console.error('DOAJ API error:', e instanceof Error ? e.message : e);
    return 0;
  }
}
