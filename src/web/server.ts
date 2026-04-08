import { db, pool } from '../db/connection.js';
import { agentTasks, findings, researchLog, discoveries, library, projects } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { searchSimilar } from '../llm/embeddings.js';
import { loadState } from '../rektor/state.js';
import { Dispatcher } from '../rektor/dispatcher.js';
import { LLM } from '../llm/llm.js';
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
    tasksCompleted: Number(taskCounts.completed),
    lastReflection: state.lastReflection,
    currentFocus: state.currentFocus,
    rateLimited: LLM.isCurrentlyRateLimited(),
    rateLimitWaitMin: Math.ceil(LLM.getRateLimitWaitMs() / 60_000),
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

async function handleAgents(): Promise<Response> {
  // Currently running tasks — the real source of truth for "active"
  const active = await db
    .select({
      agentType: agentTasks.agentType,
      startedAt: agentTasks.startedAt,
      payload: agentTasks.payload,
    })
    .from(agentTasks)
    .where(sql`${agentTasks.status} = 'in_progress'`);

  // Recent log events — use DB time with now() to avoid timezone issues
  const recentActivity = await db
    .select({
      agentType: researchLog.agentType,
      eventType: researchLog.eventType,
      minutesAgo: sql<number>`extract(epoch from (now() - ${researchLog.createdAt})) / 60`,
    })
    .from(researchLog)
    .where(sql`${researchLog.createdAt} > now() - interval '30 minutes'`)
    .orderBy(desc(researchLog.createdAt))
    .limit(50);

  // Build agent status map
  const agents: Record<string, { status: string; minutesAgo: number | null; currentTask: string | null; count: number }> = {
    'rektor': { status: 'idle', minutesAgo: null, currentTask: null, count: 0 },
    'linguist': { status: 'idle', minutesAgo: null, currentTask: null, count: 0 },
    'methodology-reader': { status: 'idle', minutesAgo: null, currentTask: null, count: 0 },
    'source:doaj': { status: 'idle', minutesAgo: null, currentTask: null, count: 0 },
    'cataloguer': { status: 'idle', minutesAgo: null, currentTask: null, count: 0 },
    'synthesis': { status: 'idle', minutesAgo: null, currentTask: null, count: 0 },
    'supervisor': { status: 'idle', minutesAgo: null, currentTask: null, count: 0 },
    'discovery-pipeline': { status: 'idle', minutesAgo: null, currentTask: null, count: 0 },
  };

  // Dispatcher workers (catalogue, scout, synthesis, etc. — not in agent_tasks)
  const dispatcher = Dispatcher.getCurrent();
  if (dispatcher) {
    for (const workType of dispatcher.getActiveWork()) {
      // Map work types to agent names
      const key = workType.startsWith('research:') ? workType.split(':')[1]
        : workType === 'catalogue' ? 'cataloguer'
        : workType;
      if (agents[key]) {
        agents[key].status = 'active';
        agents[key].count++;
      }
    }
  }

  // Active tasks = definitely running now
  for (const task of active) {
    const taskDesc = (task.payload as Record<string, unknown>)?.description
      ?? (task.payload as Record<string, unknown>)?.task ?? '';
    if (agents[task.agentType]) {
      agents[task.agentType].status = 'active';
      agents[task.agentType].currentTask = String(taskDesc).slice(0, 100);
      agents[task.agentType].count++;
    }
  }

  // Recent log = was active recently
  for (const event of recentActivity) {
    const type = event.agentType ?? '';
    const key = type.includes(':') ? type.split(':')[0] : type;
    if (agents[key] && agents[key].minutesAgo === null) {
      agents[key].minutesAgo = Math.round(Number(event.minutesAgo));
      if (agents[key].status === 'idle') agents[key].status = 'recent';
    }
  }

  return Response.json(agents);
}

async function handleLibrary(): Promise<Response> {
  const [counts] = await db.select({
    total: sql<number>`count(*)`,
    raw: sql<number>`count(*) filter (where status = 'raw')`,
    catalogued: sql<number>`count(*) filter (where status = 'catalogued')`,
    embedded: sql<number>`count(*) filter (where status = 'embedded')`,
  }).from(library);

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
    .limit(100);

  return Response.json({
    total: Number(counts.total),
    raw: Number(counts.raw),
    catalogued: Number(counts.catalogued),
    embedded: Number(counts.embedded),
    items: rows,
  });
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
        if (url.pathname === '/api/agents') {
          const res = await handleAgents();
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
        if (url.pathname.match(/^\/api\/library\/\d+$/)) {
          const id = parseInt(url.pathname.split('/').pop()!);
          const [row] = await db.select().from(library).where(eq(library.id, id)).limit(1);
          if (!row) return new Response('Not found', { status: 404 });
          return Response.json(row, { headers });
        }
        if (url.pathname === '/api/library/search') {
          const query = url.searchParams.get('q');
          if (!query) return new Response(JSON.stringify({ error: 'Missing ?q= parameter' }), { status: 400, headers });
          // Full-text search across library
          const results = await db
            .select({
              id: library.id,
              title: library.title,
              contentType: library.contentType,
              author: library.author,
              summary: library.summary,
              tags: library.tags,
              topics: library.topics,
              qualityScore: library.qualityScore,
              sourceCredibility: library.sourceCredibility,
              peerReviewed: library.peerReviewed,
              url: library.url,
            })
            .from(library)
            .where(sql`
              ${library.title} ILIKE ${'%' + query + '%'}
              OR ${library.content} ILIKE ${'%' + query + '%'}
              OR ${library.summary} ILIKE ${'%' + query + '%'}
              OR ${library.tags}::text ILIKE ${'%' + query + '%'}
              OR ${library.topics}::text ILIKE ${'%' + query + '%'}
              OR ${library.author} ILIKE ${'%' + query + '%'}
            `)
            .limit(20);
          return new Response(JSON.stringify(results), { headers: { ...headers, 'Content-Type': 'application/json' } });
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
        // ── Project API ──
        if (url.pathname === '/api/projects' && req.method === 'GET') {
          const rows = await db.select().from(projects).orderBy(desc(projects.createdAt));
          return Response.json(rows, { headers });
        }
        if (url.pathname === '/api/projects' && req.method === 'POST') {
          const body = await req.json() as { title: string; description?: string };
          const [project] = await db.insert(projects).values({
            title: body.title,
            description: body.description ?? null,
          }).returning();
          await db.insert(researchLog).values({
            eventType: 'project_created', agentType: 'user',
            details: { projectId: project.id, title: project.title },
          });
          return Response.json(project, { headers });
        }
        if (url.pathname.match(/^\/api\/projects\/\d+$/) && req.method === 'GET') {
          const id = parseInt(url.pathname.split('/').pop()!);
          const [project] = await db.select().from(projects).where(eq(projects.id, id));
          if (!project) return new Response('Not found', { status: 404 });

          const projectFindings = await db.select().from(findings)
            .where(eq(findings.projectId, id)).orderBy(desc(findings.createdAt)).limit(50);
          const projectTasks = await db.select({
            pending: sql<number>`count(*) filter (where status = 'pending' and project_id = ${id})`,
            inProgress: sql<number>`count(*) filter (where status = 'in_progress' and project_id = ${id})`,
            completed: sql<number>`count(*) filter (where status = 'completed' and project_id = ${id})`,
          }).from(agentTasks);
          const projectLog = await db.select().from(researchLog)
            .where(sql`${researchLog.details}->>'projectId' = ${String(id)}`)
            .orderBy(desc(researchLog.createdAt)).limit(50);

          return Response.json({
            ...project,
            findings: projectFindings,
            tasks: { pending: Number(projectTasks[0].pending), inProgress: Number(projectTasks[0].inProgress), completed: Number(projectTasks[0].completed) },
            log: projectLog,
          }, { headers });
        }
        if (url.pathname.match(/^\/api\/projects\/\d+$/) && req.method === 'PATCH') {
          const id = parseInt(url.pathname.split('/').pop()!);
          const body = await req.json() as { status?: string; workers?: number };
          await db.update(projects).set({ ...body, updatedAt: new Date() }).where(eq(projects.id, id));
          const [updated] = await db.select().from(projects).where(eq(projects.id, id));
          return Response.json(updated, { headers });
        }
        if (url.pathname.match(/^\/api\/projects\/\d+\/generate$/) && req.method === 'POST') {
          const id = parseInt(url.pathname.split('/').pop()!.replace('/generate', ''));
          // Will be handled by dispatcher — just mark as needing work
          await db.insert(researchLog).values({
            eventType: 'project_generate_requested', agentType: 'user',
            details: { projectId: id },
          });
          return Response.json({ ok: true }, { headers });
        }

        // ── Pages ──
        if (url.pathname === '/' || url.pathname === '/index.html') {
          return new Response(Bun.file(DASHBOARD_HTML));
        }
        if (url.pathname === '/projects') {
          return new Response(Bun.file(join(import.meta.dir, 'projects.html')));
        }
        if (url.pathname.match(/^\/project\/\d+$/)) {
          return new Response(Bun.file(join(import.meta.dir, 'project.html')));
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
