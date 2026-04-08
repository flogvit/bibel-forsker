/**
 * Bulk download academic articles using the DOAJ API agent.
 * Run: bun scripts/bulk-download.ts
 * Run with more pages: bun scripts/bulk-download.ts --pages 50
 */
import { bulkDownload } from '../src/agents/scout/doaj-api.js';

const maxPages = parseInt(process.argv.find(a => a.startsWith('--pages='))?.split('=')[1] ?? '20');

console.log(`Bulk downloading from DOAJ (max ${maxPages} pages per term)...\n`);

const total = await bulkDownload(maxPages);

const { db } = await import('../src/db/connection.js');
const { library } = await import('../src/db/schema.js');
const { sql } = await import('drizzle-orm');
const [count] = await db.select({
  total: sql<number>`count(*)`,
  raw: sql<number>`count(*) filter (where status = 'raw')`,
  embedded: sql<number>`count(*) filter (where status = 'embedded')`,
}).from(library);

console.log(`\nBibliotek: ${count.total} totalt (${count.raw} ukatalogisert, ${count.embedded} embedded)`);
process.exit(0);
