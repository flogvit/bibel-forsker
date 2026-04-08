import { db, pool } from '../db/connection.js';
import { agentTasks, findings, researchLog, discoveries, library } from '../db/schema.js';
import { searchSimilar } from '../llm/embeddings.js';
import { loadState } from '../rektor/state.js';
import { desc, sql } from 'drizzle-orm';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const RESEARCH_RULES_PATH = join(process.cwd(), 'research/strategy.md');
const DASHBOARD_HTML = join(import.meta.dir, 'dashboard.html');

async function handleStatus(): Promise<Response> {
  const state = await loadState();

  const [taskCounts] = await db
    .select({
      pending: sql<number>`count(*) filter (where status = 'pending')`,
      inProgress: sql<number>`count(*) filter (where status = 'in_progress')`,
      completed: sql<number>`count(*) filter (where status = 'completed')`,
      failed: sql<number>`count(*) filter (where status = 'failed')`,
    })
    .from(agentTasks);

  const [findingCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(findings);

  return Response.json({
    running: state.running,
    startedAt: state.startedAt,
    tasksCompleted: state.tasksCompleted,
    lastReflection: state.lastReflection,
    currentFocus: state.currentFocus,
    tasks: {
      pending: Number(taskCounts.pending),
      inProgress: Number(taskCounts.inProgress),
      completed: Number(taskCounts.completed),
      failed: Number(taskCounts.failed),
    },
    findingCount: Number(findingCount.count),
  });
}

async function handleFindings(): Promise<Response> {
  const rows = await db
    .select()
    .from(findings)
    .orderBy(desc(findings.createdAt))
    .limit(50);

  return Response.json(rows);
}

async function handleLog(): Promise<Response> {
  const rows = await db
    .select()
    .from(researchLog)
    .orderBy(desc(researchLog.createdAt))
    .limit(100);

  return Response.json(rows);
}

async function handleRules(): Promise<Response> {
  // Return all research files: strategy + methods + agent instructions
  const researchDir = join(process.cwd(), 'research');
  const files: Array<{ path: string; name: string; content: string; category: string }> = [];

  // Strategy
  if (existsSync(RESEARCH_RULES_PATH)) {
    files.push({
      path: 'research/strategy.md',
      name: 'Forskningsstrategi',
      content: await readFile(RESEARCH_RULES_PATH, 'utf-8'),
      category: 'strategi',
    });
  }

  // Methods
  const methodsDir = join(researchDir, 'methods');
  if (existsSync(methodsDir)) {
    for (const file of await readdir(methodsDir)) {
      if (file.endsWith('.md')) {
        const content = await readFile(join(methodsDir, file), 'utf-8');
        files.push({
          path: `research/methods/${file}`,
          name: file.replace('.md', '').replace(/-/g, ' '),
          content,
          category: 'metode',
        });
      }
    }
  }

  // Agent instructions
  const agentsDir = join(researchDir, 'agents');
  if (existsSync(agentsDir)) {
    for (const file of await readdir(agentsDir)) {
      if (file.endsWith('.md')) {
        const content = await readFile(join(agentsDir, file), 'utf-8');
        files.push({
          path: `research/agents/${file}`,
          name: file.replace('.md', '').replace(/-/g, ' '),
          content,
          category: 'agent',
        });
      }
    }
  }

  return Response.json({ files });
}

async function handleLibrary(): Promise<Response> {
  const rows = await db
    .select({
      id: library.id,
      title: library.title,
      contentType: library.contentType,
      tags: library.tags,
      topics: library.topics,
      qualityScore: library.qualityScore,
      peerReviewed: library.peerReviewed,
      sourceCredibility: library.sourceCredibility,
      author: library.author,
      summary: library.summary,
      status: library.status,
      url: library.url,
      scoutedAt: library.scoutedAt,
    })
    .from(library)
    .orderBy(desc(library.scoutedAt))
    .limit(50);

  return Response.json(rows);
}

async function handleClusters(): Promise<Response> {
  // Get cluster events from research log
  const rows = await db
    .select()
    .from(researchLog)
    .where(sql`${researchLog.eventType} IN ('cluster_found', 'cluster_mature')`)
    .orderBy(desc(researchLog.createdAt))
    .limit(50);

  return Response.json(rows);
}

async function handleDiscoveries(): Promise<Response> {
  const rows = await db
    .select()
    .from(discoveries)
    .orderBy(desc(discoveries.createdAt))
    .limit(50);

  return Response.json(rows);
}

async function handleDiscoveryPaper(id: number): Promise<Response> {
  const [row] = await db
    .select()
    .from(discoveries)
    .where(sql`${discoveries.id} = ${id}`)
    .limit(1);

  if (!row) return new Response('Not found', { status: 404 });
  return Response.json(row);
}

export function startWebServer(port: number): void {
  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);

      // CORS for dev convenience
      const headers = { 'Access-Control-Allow-Origin': '*' };

      try {
        if (url.pathname === '/api/status') {
          const res = await handleStatus();
          return new Response(res.body, { status: res.status, headers: { ...headers, 'Content-Type': 'application/json' } });
        }
        if (url.pathname === '/api/findings') {
          const res = await handleFindings();
          return new Response(res.body, { status: res.status, headers: { ...headers, 'Content-Type': 'application/json' } });
        }
        if (url.pathname === '/api/log') {
          const res = await handleLog();
          return new Response(res.body, { status: res.status, headers: { ...headers, 'Content-Type': 'application/json' } });
        }
        if (url.pathname === '/api/library') {
          const res = await handleLibrary();
          return new Response(res.body, { status: res.status, headers: { ...headers, 'Content-Type': 'application/json' } });
        }
        if (url.pathname === '/api/search') {
          const query = url.searchParams.get('q');
          if (!query) return new Response(JSON.stringify({ error: 'Missing ?q= parameter' }), { status: 400, headers });
          try {
            const results = await searchSimilar(query, 10);
            return Response.json(results);
          } catch (e) {
            return Response.json({ error: 'Søk krever Ollama med nomic-embed-text', detail: String(e) });
          }
        }
        if (url.pathname === '/api/clusters') {
          const res = await handleClusters();
          return new Response(res.body, { status: res.status, headers: { ...headers, 'Content-Type': 'application/json' } });
        }
        if (url.pathname === '/api/discoveries') {
          const res = await handleDiscoveries();
          return new Response(res.body, { status: res.status, headers: { ...headers, 'Content-Type': 'application/json' } });
        }
        if (url.pathname.startsWith('/api/discoveries/')) {
          const id = parseInt(url.pathname.split('/').pop()!);
          const res = await handleDiscoveryPaper(id);
          return new Response(res.body, { status: res.status, headers: { ...headers, 'Content-Type': 'application/json' } });
        }
        if (url.pathname === '/api/rules') {
          const res = await handleRules();
          return new Response(res.body, { status: res.status, headers: { ...headers, 'Content-Type': 'application/json' } });
        }
        if (url.pathname === '/' || url.pathname === '/index.html') {
          return new Response(Bun.file(DASHBOARD_HTML));
        }
      } catch (err) {
        console.error('API error:', err);
        return new Response(JSON.stringify({ error: 'Internal server error' }), {
          status: 500,
          headers: { ...headers, 'Content-Type': 'application/json' },
        });
      }

      return new Response('Not found', { status: 404 });
    },
  });

  console.log(`Dashboard running at http://localhost:${server.port}`);
  console.log('Press Ctrl+C to stop.');

  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await pool.close();
    server.stop();
    process.exit(0);
  });
  process.on('SIGTERM', async () => {
    await pool.close();
    server.stop();
    process.exit(0);
  });
}
