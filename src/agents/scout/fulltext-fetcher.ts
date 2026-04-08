import { db } from '../../db/connection.js';
import { library, researchLog } from '../../db/schema.js';
import { eq, sql, and, isNotNull } from 'drizzle-orm';

/**
 * Fulltext fetcher agent.
 * Takes library items that only have abstracts and fetches the full article.
 *
 * Strategy:
 * 1. Try direct fetch of the URL
 * 2. If that gives a landing page, ask Ollama to find the actual article link
 * 3. Fetch that link
 */

const ABSTRACT_MAX_LENGTH = 2000;
const DELAY_MS = 3000;
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'gemma3:27b';

function stripHTML(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchURL(url: string): Promise<{ html: string; text: string; contentType: string } | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'BibleResearchBot/1.0 (academic research)',
        'Accept': 'text/html,application/xhtml+xml,text/plain',
      },
      redirect: 'follow',
    });
    if (!response.ok) return null;

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/pdf')) return null; // Skip PDFs for now

    const html = await response.text();
    return { html, text: stripHTML(html), contentType };
  } catch {
    return null;
  }
}

async function askOllamaForLink(html: string, originalUrl: string): Promise<string | null> {
  const truncatedHtml = html.slice(0, 15000);

  const prompt = `This is an academic article landing page. Find the URL to the full text article (not PDF).
Look for links like "View Full Text", "Read Article", "Full Text HTML", "View Article", or similar.
The page URL is: ${originalUrl}

Return ONLY the full URL to the article text. Nothing else. If you can't find it, return "NONE".

HTML:
${truncatedHtml}`;

  try {
    const proc = Bun.spawn(['ollama', 'launch', 'claude', '--model', OLLAMA_MODEL], {
      stdin: new Response(prompt),
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const output = await new Response(proc.stdout).text();
    await proc.exited;

    const link = output.trim().split('\n').pop()?.trim() ?? '';
    if (link === 'NONE' || link.length < 10 || !link.startsWith('http')) return null;
    return link;
  } catch {
    return null;
  }
}

async function fetchFulltext(url: string): Promise<string | null> {
  // Step 1: Direct fetch
  const page = await fetchURL(url);
  if (!page) return null;

  // If we got substantial text, it's probably the article
  if (page.text.length > ABSTRACT_MAX_LENGTH) {
    return page.text;
  }

  // Step 2: It's probably a landing page. Ask Ollama for the real link.
  const articleLink = await askOllamaForLink(page.html, url);
  if (!articleLink) return null;

  // Step 3: Fetch the actual article
  const article = await fetchURL(articleLink);
  if (!article || article.text.length < ABSTRACT_MAX_LENGTH) return null;

  return article.text;
}

/**
 * Run the fulltext fetcher. Processes all library items with URLs
 * that still only have abstracts.
 */
export async function run(): Promise<void> {
  const items = await db
    .select({ id: library.id, url: library.url, title: library.title })
    .from(library)
    .where(
      and(
        isNotNull(library.url),
        sql`length(${library.content}) < ${ABSTRACT_MAX_LENGTH}`,
        sql`${library.status} NOT IN ('fulltext_failed', 'fulltext_skipped')`,
      ),
    );

  if (items.length === 0) {
    console.log('Fulltext fetcher: nothing to fetch.');
    return;
  }

  console.log(`Fulltext fetcher: ${items.length} articles to process...`);
  let fetched = 0;
  let failed = 0;

  for (const item of items) {
    if (!item.url) continue;

    const text = await fetchFulltext(item.url);

    if (text) {
      await db.update(library)
        .set({ content: text, status: 'raw' })
        .where(eq(library.id, item.id));
      fetched++;
      console.log(`  ✓ ${item.title.slice(0, 60)}`);
    } else {
      await db.update(library)
        .set({ status: 'fulltext_failed' })
        .where(eq(library.id, item.id));
      failed++;
    }

    await Bun.sleep(DELAY_MS);
  }

  await db.insert(researchLog).values({
    eventType: 'fulltext_fetch_complete',
    agentType: 'source:fulltext',
    details: { fetched, failed, attempted: items.length },
  });

  console.log(`Fulltext fetcher done: ${fetched} fetched, ${failed} failed out of ${items.length}.`);
}
