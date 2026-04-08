import { db } from '../db/connection.js';
import { agentTasks, findings, researchLog, library, projects } from '../db/schema.js';
import { eq, desc, sql } from 'drizzle-orm';
import { LLM, RateLimitError } from '../llm/llm.js';
import { loadState, saveState, readResearchRules, type RektorState } from './state.js';
import { Reflector } from './reflector.js';
import { Triage } from './triage.js';
import { Reviewer } from './reviewer.js';
import { Supervisor } from './supervisor.js';
import { MethodologyReader } from '../agents/pensum/methodology-reader.js';
import { Linguist } from '../agents/forsker/linguist.js';
import { type BaseAgent } from '../agents/base-agent.js';
import { DiscoveryPipeline } from '../agents/discovery-pipeline.js';
import { SynthesisAgent } from '../agents/synthesis-agent.js';
import { Cataloguer } from '../agents/scout/cataloguer.js';
import { run as runDOAJ } from '../agents/scout/doaj-api.js';
import { embedFindings } from '../llm/embeddings.js';
import { PROMPTS } from '../llm/prompts.js';
import { FreeBible } from '../data/free-bible.js';
import { resolve } from 'node:path';

export interface DispatcherConfig {
  rektorLLM: LLM;
  agentLLM: LLM;
  researchRulesPath: string;
  concurrency: number;
}

interface WorkItem {
  type: string;
  priority: number; // Lower = higher priority
  run: () => Promise<void>;
}

export class Dispatcher {
  private config: DispatcherConfig;
  private running = false;
  private activeWorkers = 0;
  private state: RektorState | null = null;
  private agents: Map<string, BaseAgent> = new Map();
  private tasksSinceReflection = 0;
  private tasksSinceDiscoveryScan = 0;
  private lastScoutTime = 0;
  private lastSupervisorTime = 0;
  private dispatching = false;
  private cataloguing = false;
  private activeWorkTypes: string[] = [];

  /** What the dispatcher is currently running — used by dashboard */
  getActiveWork(): string[] {
    return [...this.activeWorkTypes];
  }

  // Singleton for API access
  private static instance: Dispatcher | null = null;
  static getCurrent(): Dispatcher | null { return Dispatcher.instance; }

  constructor(config: DispatcherConfig) {
    this.config = config;
  }

  isRunning(): boolean {
    return this.running;
  }

  async start(): Promise<void> {
    // Reset any orphaned in_progress tasks from previous run
    const reset = await db
      .update(agentTasks)
      .set({ status: 'pending', startedAt: null })
      .where(eq(agentTasks.status, 'in_progress'))
      .returning();
    if (reset.length > 0) {
      console.log(`Reset ${reset.length} orphaned in_progress tasks to pending.`);
    }

    this.running = true;
    Dispatcher.instance = this;
    // Fast tick — just checks if there's a free slot and fills it
    setInterval(() => this.tick(), 2000);
    console.log(`Dispatcher started (${this.config.concurrency} workers).`);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.state) {
      this.state.running = false;
      await saveState(this.state);
    }
    console.log('Dispatcher stopped.');
  }

  private async tick(): Promise<void> {
    if (!this.running || this.dispatching) return;
    if (this.activeWorkers >= this.config.concurrency) return;

    // If rate limited, don't dispatch anything
    if (LLM.isCurrentlyRateLimited()) {
      const waitMin = Math.ceil(LLM.getRateLimitWaitMs() / 60_000);
      if (this.activeWorkers === 0) {
        console.log(`⏸  Rate limited. Waiting ${waitMin} min...`);
      }
      return;
    }

    this.dispatching = true;
    try {
      if (!this.state) {
        this.state = await loadState();
        this.state.running = true;
        this.state.startedAt = new Date().toISOString();
        await saveState(this.state);
      }

      // Fill all free slots
      while (this.activeWorkers < this.config.concurrency) {
        const work = await this.findWork();
        if (!work) break;

        this.activeWorkers++;
        this.activeWorkTypes.push(work.type);
        console.log(`Dispatching: ${work.type}`);
        work.run().catch(err => {
          console.error(`Worker error (${work.type}):`, err instanceof Error ? err.message : err);
        }).finally(() => {
          this.activeWorkers--;
          const idx = this.activeWorkTypes.indexOf(work.type);
          if (idx >= 0) this.activeWorkTypes.splice(idx, 1);
        });
      }
    } finally {
      this.dispatching = false;
    }
  }

  /**
   * Find the highest priority work item available right now.
   * Returns null if nothing to do.
   */
  private async findWork(): Promise<WorkItem | null> {
    const now = Date.now();

    // Priority 1: Uncatalogued library materials (max 1 worker at a time)
    if (!this.cataloguing) {
      const [rawCount] = await db.select({ count: sql<number>`count(*)` })
        .from(library).where(eq(library.status, 'raw'));
      if (Number(rawCount.count) > 0) {
        this.cataloguing = true;
        return {
          type: 'catalogue',
          priority: 1,
          run: async () => {
            try { await this.runCatalogue(); }
            finally { this.cataloguing = false; }
          },
        };
      }
    }

    // Priority 2: Active projects — phase-based work
    const activeProjects = await db.select().from(projects).where(eq(projects.status, 'active'));
    for (const project of activeProjects) {
      const [projectPending] = await db.select({ count: sql<number>`count(*)` })
        .from(agentTasks)
        .where(sql`${agentTasks.projectId} = ${project.id} AND ${agentTasks.status} IN ('pending', 'in_progress')`);

      if (Number(projectPending.count) === 0) {
        return {
          type: `project:${project.id}:${project.phase}`,
          priority: 2,
          run: () => this.runProjectPhase(project),
        };
      }
    }

    // Priority 3: Pending research tasks (project tasks first, then general)
    const [task] = await db.select()
      .from(agentTasks)
      .where(eq(agentTasks.status, 'pending'))
      .orderBy(sql`CASE WHEN project_id IS NOT NULL THEN 0 ELSE 1 END`, agentTasks.priority)
      .limit(1);
    if (task) {
      // Mark in progress immediately so next tick doesn't pick it again
      await db.update(agentTasks)
        .set({ status: 'in_progress', startedAt: new Date() })
        .where(eq(agentTasks.id, task.id));
      return {
        type: `research:${task.agentType}`,
        priority: 2,
        run: () => this.runResearchTask(task),
      };
    }

    // Priority 3: Reflect if enough tasks done
    if (this.tasksSinceReflection >= 3) {
      return {
        type: 'reflect',
        priority: 3,
        run: () => this.runReflection(),
      };
    }

    // Priority 4: Synthesis + discovery if enough tasks
    if (this.tasksSinceDiscoveryScan >= 15) {
      return {
        type: 'synthesis',
        priority: 4,
        run: () => this.runSynthesis(),
      };
    }

    // Priority 6: Generate new work if queue is empty
    const [pendingCount] = await db.select({ count: sql<number>`count(*)` })
      .from(agentTasks).where(eq(agentTasks.status, 'pending'));
    if (Number(pendingCount.count) === 0 && this.activeWorkers <= 1) {
      return {
        type: 'generate',
        priority: 5,
        run: () => this.runGenerateWork(),
      };
    }

    // Priority 7: Supervisor check every 5 min
    if (now - this.lastSupervisorTime > 300_000) {
      this.lastSupervisorTime = now;
      return {
        type: 'supervisor',
        priority: 6,
        run: () => this.runSupervisor(),
      };
    }

    // Priority 8: DOAJ source agent — runs once, then daily
    if (this.lastScoutTime === 0 || now - this.lastScoutTime > 86_400_000) {
      this.lastScoutTime = now;
      return {
        type: 'source:doaj',
        priority: 8,
        run: () => this.runDOAJSource(),
      };
    }

    return null;
  }

  // ── Worker implementations ──────────────────────────

  private async runCatalogue(): Promise<void> {
    const cataloguer = new Cataloguer(this.config.agentLLM);
    await cataloguer.catalogueNew();
  }

  private async runResearchTask(task: typeof agentTasks.$inferSelect): Promise<void> {
    const taskDescription = (task.payload as Record<string, unknown>)?.description
      ?? (task.payload as Record<string, unknown>)?.task ?? 'unknown task';

    // Triage
    const isSplitChild = (task.payload as Record<string, unknown>)?.fromSplit === true;
    if (!isSplitChild) {
      try {
        const triage = new Triage(this.config.rektorLLM);
        const triageResult = await triage.evaluate(task.agentType, String(taskDescription));

        if (triageResult.verdict === 'split' && triageResult.subtasks?.length) {
          for (const sub of triageResult.subtasks) {
            const basePayload = sub.agentType === 'methodology-reader'
              ? { description: sub.description, material: sub.description }
              : await this.buildLinguistPayload(sub.description);
            await db.insert(agentTasks).values({
              agentType: sub.agentType, status: 'pending', priority: sub.priority,
              payload: { ...basePayload, fromSplit: true },
            });
          }
          await db.update(agentTasks)
            .set({ status: 'completed', result: { triaged: 'split' }, completedAt: new Date() })
            .where(eq(agentTasks.id, task.id));
          await db.insert(researchLog).values({
            eventType: 'task_split', agentType: task.agentType,
            details: { taskId: task.id, description: taskDescription, subtasks: triageResult.subtasks.length },
          });
          return;
        }
        if (triageResult.verdict === 'skip') {
          await db.update(agentTasks)
            .set({ status: 'completed', result: { triaged: 'skipped' }, completedAt: new Date() })
            .where(eq(agentTasks.id, task.id));
          return;
        }
      } catch { /* triage failed, proceed */ }
    }

    // Execute
    try {
      const agent = this.getAgent(task.agentType);
      const result = await agent.execute(task.payload as Record<string, unknown>);

      // Review
      let reviewQuality = 'unreviewed';
      try {
        const reviewer = new Reviewer(this.config.rektorLLM);
        const review = await reviewer.review(String(taskDescription), result);
        reviewQuality = review.quality;
        if (!review.approved) result.evidenceStrength = 'speculation';
      } catch { /* review failed */ }

      await db.insert(findings).values({
        agentType: task.agentType, taskId: task.id,
        projectId: task.projectId ?? null,
        finding: result.finding, evidenceStrength: result.evidenceStrength,
        reasoning: result.reasoning, sources: result.sources,
        metadata: { ...result.metadata ?? {}, reviewQuality },
      });

      // Update project findings count
      if (task.projectId) {
        const [count] = await db.select({ count: sql<number>`count(*)` })
          .from(findings).where(eq(findings.projectId, task.projectId));
        await db.update(projects).set({ findingsCount: Number(count.count), updatedAt: new Date() })
          .where(eq(projects.id, task.projectId));
      }

      await db.update(agentTasks)
        .set({ status: 'completed', result, completedAt: new Date() })
        .where(eq(agentTasks.id, task.id));

      await db.insert(researchLog).values({
        eventType: 'task_completed', agentType: task.agentType,
        details: { taskId: task.id, description: taskDescription, finding: result.finding, evidenceStrength: result.evidenceStrength, reviewQuality },
      });

      this.tasksSinceReflection++;
      this.tasksSinceDiscoveryScan++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db.update(agentTasks)
        .set({ status: 'failed', error: message, completedAt: new Date() })
        .where(eq(agentTasks.id, task.id));
      await db.insert(researchLog).values({
        eventType: 'task_failed', agentType: task.agentType,
        details: { taskId: task.id, description: taskDescription, error: message },
      });
    }
  }

  private async runReflection(): Promise<void> {
    this.tasksSinceReflection = 0;
    const reflector = new Reflector(this.config.rektorLLM, this.config.researchRulesPath);
    const recentFindings = await db.select().from(findings).orderBy(desc(findings.createdAt)).limit(10);
    const reflection = await reflector.reflect(
      recentFindings.map(f => ({ agentType: f.agentType, result: f.finding }))
    );

    for (const next of reflection.nextTasks.slice(0, 3)) {
      const payload = next.agentType === 'methodology-reader'
        ? { description: next.description, material: next.description }
        : await this.buildLinguistPayload(next.description);
      await db.insert(agentTasks).values({
        agentType: next.agentType, status: 'pending', priority: next.priority, payload,
      });
    }

    await db.insert(researchLog).values({
      eventType: 'reflection', agentType: 'rektor',
      details: { learnings: reflection.learnings, newTasks: reflection.nextTasks.length },
    });

    // Embed new findings
    try { await embedFindings(); } catch { /* Ollama not running */ }
  }

  private async runSynthesis(): Promise<void> {
    this.tasksSinceDiscoveryScan = 0;
    const synthesis = new SynthesisAgent(this.config.rektorLLM);
    const result = await synthesis.synthesize();

    if (result?.suggestedTasks) {
      for (const task of result.suggestedTasks.slice(0, 3)) {
        const payload = task.agentType === 'methodology-reader'
          ? { description: task.description, material: task.description }
          : await this.buildLinguistPayload(task.description);
        await db.insert(agentTasks).values({
          agentType: task.agentType, status: 'pending', priority: task.priority, payload,
        });
      }
    }

    const pipeline = new DiscoveryPipeline(this.config.rektorLLM);
    await pipeline.scanForDiscoveries();
    await pipeline.reviewPapers();
  }

  private async runSupervisor(): Promise<void> {
    const supervisor = new Supervisor(this.config.rektorLLM);
    await supervisor.check();
  }

  private async runProjectPhase(project: typeof projects.$inferSelect): Promise<void> {
    console.log(`Project "${project.title}" — phase: ${project.phase}`);

    switch (project.phase) {
      case 'literature_search':
        await this.projectLiteratureSearch(project);
        break;
      case 'literature_review':
        await this.projectLiteratureReview(project);
        break;
      case 'identify_gaps':
        await this.projectIdentifyGaps(project);
        break;
      case 'research':
        await this.projectResearch(project);
        break;
      case 'paper':
        await this.projectWritePaper(project);
        break;
    }
  }

  private async projectLiteratureSearch(project: typeof projects.$inferSelect): Promise<void> {
    console.log(`Project "${project.title}": searching for existing research...`);

    const { downloadTerm } = await import('../agents/scout/doaj-api.js');

    // Generate search terms from project title
    const searchTerms = [
      project.title,
      ...(project.title.split(/\s+/).filter(w => w.length > 3)),
    ];

    let totalSaved = 0;

    for (const term of searchTerms) {
      try {
        totalSaved += await downloadTerm(term);
      } catch (e) {
        console.error('DOAJ search error:', e);
      }
    }

    // Tag relevant articles with project ID
    for (const term of searchTerms) {
      await db.execute(sql`
        UPDATE library SET project_id = ${project.id}
        WHERE project_id IS NULL
        AND (title ILIKE ${'%' + term + '%'} OR content ILIKE ${'%' + term + '%'})
      `);
    }

    // LLM-based search for more context
    try {
      const prompt = `Søk på nettet etter eksisterende akademisk forskning om: "${project.title}"

Bruk WebSearch for å finne:
1. Akademiske artikler om dette temaet
2. Bokkapitler og monografier
3. Encyklopedi-oppslag
4. Viktige forskere som har jobbet med dette

For hvert funn, hent innholdet med WebFetch.

Svar med JSON:
\`\`\`json
{
  "materials": [
    {"url": "string", "title": "string", "content": "teksten", "contentType": "article", "author": "forfatter", "year": 2020, "relevance": "kort"}
  ]
}
\`\`\``;

      const response = await this.config.rektorLLM.callJSON<{
        materials: Array<{ url: string; title: string; content: string; contentType: string; author?: string; year?: number; relevance: string }>;
      }>(prompt);

      for (const mat of response.data.materials) {
        if (!mat.content || mat.content.length < 100) continue;
        await db.insert(library).values({
          url: mat.url || null,
          title: mat.title,
          content: mat.content,
          contentType: mat.contentType || 'article',
          author: mat.author || null,
          publicationYear: mat.year || null,
          projectId: project.id,
          status: 'raw',
        });
        totalSaved++;
      }
    } catch (e) {
      console.error('LLM search error:', e);
    }

    // Update project
    const [libCount] = await db.select({ count: sql<number>`count(*)` })
      .from(library).where(eq(library.projectId, project.id));

    await db.update(projects).set({
      libraryCount: Number(libCount.count),
      phase: 'literature_review', // Move to next phase
      updatedAt: new Date(),
    }).where(eq(projects.id, project.id));

    await db.insert(researchLog).values({
      eventType: 'project_phase_complete', agentType: 'rektor',
      details: { projectId: project.id, title: project.title, phase: 'literature_search', materialsFound: totalSaved },
    });

    console.log(`Project "${project.title}": found ${totalSaved} materials. Moving to literature_review.`);
  }

  private async projectLiteratureReview(project: typeof projects.$inferSelect): Promise<void> {
    console.log(`Project "${project.title}": reviewing literature...`);

    // Get all project-related library material
    const materials = await db.select({
      title: library.title,
      content: library.content,
      author: library.author,
      summary: library.summary,
    }).from(library).where(eq(library.projectId, project.id)).limit(30);

    // Also search general library by relevance
    const generalMaterials = await db.select({
      title: library.title,
      summary: library.summary,
      author: library.author,
    }).from(library)
      .where(sql`${library.content} ILIKE ${'%' + project.title.split(' ').slice(0, 3).join('%') + '%'}`)
      .limit(20);

    const allMaterials = [...materials, ...generalMaterials];
    const materialSummaries = allMaterials.map(m =>
      `- ${m.title}${m.author ? ` (${m.author})` : ''}: ${(m.summary || m.content || '').slice(0, 300)}`
    ).join('\n');

    const prompt = `Du er en forskningsassistent. Skriv en litteraturgjennomgang for prosjektet "${project.title}".

Tilgjengelig materiale (${allMaterials.length} kilder):
${materialSummaries || '(ingen materiale funnet)'}

Skriv en strukturert litteraturgjennomgang på norsk som:
1. Oppsummerer hva som allerede er forsket på dette temaet
2. Identifiserer hovedposisjonene og debattene
3. Nevner de viktigste forskerne og deres bidrag
4. Peker på uenigheter og åpne spørsmål

Skriv i akademisk stil, maks 2000 ord.`;

    try {
      const response = await this.config.rektorLLM.call(prompt);

      await db.update(projects).set({
        literatureReview: response.text,
        phase: 'identify_gaps',
        updatedAt: new Date(),
      }).where(eq(projects.id, project.id));

      await db.insert(researchLog).values({
        eventType: 'project_phase_complete', agentType: 'rektor',
        details: { projectId: project.id, title: project.title, phase: 'literature_review', reviewLength: response.text.length },
      });

      console.log(`Project "${project.title}": literature review complete (${response.text.length} chars). Moving to identify_gaps.`);
    } catch (e) {
      console.error('Literature review error:', e);
    }
  }

  private async projectIdentifyGaps(project: typeof projects.$inferSelect): Promise<void> {
    console.log(`Project "${project.title}": identifying research gaps...`);

    const prompt = `Du er en forskningsrådgiver. Basert på denne litteraturgjennomgangen, identifiser forskningshull.

Prosjekt: ${project.title}

Litteraturgjennomgang:
${project.literatureReview || '(ingen gjennomgang tilgjengelig)'}

Identifiser:
1. Hva er IKKE forsket på innen dette temaet?
2. Hvilke spørsmål er ubesvarte?
3. Hvor er det uenighet som kan avklares med ny analyse?
4. Hva kan AI-drevet lingvistisk analyse bidra med som tradisjonell forskning ikke har gjort?

For hvert hull, foreslå konkrete forskningsoppgaver (lingvistisk analyse av spesifikke passasjer).

Svar med JSON:
\`\`\`json
{
  "gaps": [
    {"title": "kort tittel", "description": "hva som mangler", "significance": "high|medium|low"}
  ],
  "suggestedTasks": [
    {"agentType": "linguist", "description": "spesifikk oppgave", "priority": 0}
  ]
}
\`\`\``;

    try {
      const response = await this.config.rektorLLM.callJSON<{
        gaps: Array<{ title: string; description: string; significance: string }>;
        suggestedTasks: Array<{ agentType: string; description: string; priority: number }>;
      }>(prompt);

      // Save gaps
      await db.update(projects).set({
        identifiedGaps: response.data.gaps,
        phase: 'research',
        updatedAt: new Date(),
      }).where(eq(projects.id, project.id));

      // Create tasks from gaps
      for (const task of response.data.suggestedTasks.slice(0, 5)) {
        const payload = task.agentType === 'methodology-reader'
          ? { description: task.description, material: task.description }
          : await this.buildLinguistPayload(task.description);
        await db.insert(agentTasks).values({
          agentType: task.agentType, status: 'pending', priority: task.priority,
          projectId: project.id, payload,
        });
      }

      await db.insert(researchLog).values({
        eventType: 'project_phase_complete', agentType: 'rektor',
        details: { projectId: project.id, title: project.title, phase: 'identify_gaps', gaps: response.data.gaps.length, tasks: response.data.suggestedTasks.length },
      });

      console.log(`Project "${project.title}": found ${response.data.gaps.length} gaps, created ${response.data.suggestedTasks.length} tasks. Moving to research.`);
    } catch (e) {
      console.error('Gap identification error:', e);
    }
  }

  private async projectResearch(project: typeof projects.$inferSelect): Promise<void> {
    // Check if we have enough findings to write a paper
    const [count] = await db.select({ count: sql<number>`count(*)` })
      .from(findings).where(eq(findings.projectId, project.id));
    const findingCount = Number(count.count);

    await db.update(projects).set({ findingsCount: findingCount, updatedAt: new Date() })
      .where(eq(projects.id, project.id));

    if (findingCount >= 5) {
      // Enough findings — move to paper phase
      await db.update(projects).set({ phase: 'paper', updatedAt: new Date() })
        .where(eq(projects.id, project.id));
      console.log(`Project "${project.title}": ${findingCount} findings. Moving to paper.`);
      return;
    }

    // Need more research — generate tasks targeting the gaps
    const gaps = (project.identifiedGaps as Array<{ title: string; description: string }>) || [];
    if (gaps.length === 0) {
      // No gaps identified — go back
      await db.update(projects).set({ phase: 'identify_gaps', updatedAt: new Date() })
        .where(eq(projects.id, project.id));
      return;
    }

    const prompt = `Prosjekt: ${project.title}

Identifiserte forskningshull:
${gaps.map((g, i) => `${i + 1}. ${g.title}: ${g.description}`).join('\n')}

Eksisterende funn (${findingCount} stk):
${(await db.select({ finding: findings.finding }).from(findings).where(eq(findings.projectId, project.id)).limit(10))
  .map(f => `- ${f.finding.slice(0, 100)}`).join('\n')}

Generer 2-3 nye forskningsoppgaver som fyller hullene. Fokuser på det vi IKKE har funnet ut ennå.

Svar med JSON:
\`\`\`json
{"tasks": [{"agentType": "linguist", "description": "spesifikk oppgave", "priority": 0}]}
\`\`\``;

    try {
      const response = await this.config.rektorLLM.callJSON<{
        tasks: Array<{ agentType: string; description: string; priority: number }>;
      }>(prompt);

      for (const task of response.data.tasks) {
        const payload = task.agentType === 'methodology-reader'
          ? { description: task.description, material: task.description }
          : await this.buildLinguistPayload(task.description);
        await db.insert(agentTasks).values({
          agentType: task.agentType, status: 'pending', priority: task.priority,
          projectId: project.id, payload,
        });
      }
    } catch (e) {
      console.error('Project research generation error:', e);
    }
  }

  private async projectWritePaper(project: typeof projects.$inferSelect): Promise<void> {
    console.log(`Project "${project.title}": writing paper...`);

    const projectFindings = await db.select().from(findings)
      .where(eq(findings.projectId, project.id)).orderBy(desc(findings.createdAt)).limit(20);

    const prompt = `Du er en akademisk forfatter. Skriv en forskningsartikkel basert på prosjektets funn.

Prosjekt: ${project.title}

Litteraturgjennomgang:
${(project.literatureReview || '').slice(0, 3000)}

Identifiserte hull:
${JSON.stringify(project.identifiedGaps, null, 2)}

Våre funn (${projectFindings.length} stk):
${projectFindings.map(f => `[${f.evidenceStrength}] ${f.finding}`).join('\n\n')}

Skriv en akademisk artikkel på norsk som:
1. Sammendrag (abstract)
2. Innledning med forskningsspørsmål
3. Litteraturgjennomgang (kort, referer til det vi fant)
4. Metode (AI-assistert lingvistisk analyse)
5. Funn og analyse
6. Diskusjon — hva er nytt vs. kjent? Begrensninger?
7. Konklusjon
8. Referanser (KUN verifiserte, ikke oppfinn noen)

Vær ærlig om at dette er AI-assistert forskning. Fremhev kun det som faktisk er nye bidrag.`;

    try {
      const response = await this.config.rektorLLM.call(prompt);

      await db.update(projects).set({
        paperDraft: response.text,
        paperStatus: 'draft',
        phase: 'paper', // Stay in paper phase for review
        updatedAt: new Date(),
      }).where(eq(projects.id, project.id));

      await db.insert(researchLog).values({
        eventType: 'project_phase_complete', agentType: 'rektor',
        details: { projectId: project.id, title: project.title, phase: 'paper', paperLength: response.text.length },
      });

      console.log(`Project "${project.title}": paper written (${response.text.length} chars).`);
    } catch (e) {
      console.error('Paper writing error:', e);
    }
  }

  private async runDOAJSource(): Promise<void> {
    try {
      await runDOAJ();
    } catch (e) {
      console.error('DOAJ source error:', e instanceof Error ? e.message : e);
    }
  }

  private async runGenerateWork(): Promise<void> {
    // Cooldown check using DB time
    const [recentGen] = await db.select({ count: sql<number>`count(*)` })
      .from(researchLog)
      .where(sql`${researchLog.eventType} = 'generate_work' AND ${researchLog.createdAt} > now() - interval '5 minutes'`);
    if (recentGen && Number(recentGen.count) > 0) return;

    const rules = await readResearchRules(this.config.researchRulesPath);
    const recentFindings = await db.select().from(findings).orderBy(desc(findings.createdAt)).limit(10);

    const prompt = LLM.formatPrompt(PROMPTS.REKTOR_GENERATE_WORK, {
      researchRules: rules,
      previousFindings: recentFindings.map(f => `[${f.evidenceStrength}] ${f.finding.slice(0, 100)}`).join('\n'),
      currentFocus: this.state?.currentFocus ?? 'none',
    });

    const response = await this.config.rektorLLM.callJSON<{
      reasoning: string;
      tasks: Array<{ agentType: string; description: string; priority: number }>;
    }>(prompt);

    for (const task of response.data.tasks) {
      const payload = task.agentType === 'methodology-reader'
        ? { description: task.description, material: task.description }
        : await this.buildLinguistPayload(task.description);
      await db.insert(agentTasks).values({
        agentType: task.agentType, status: 'pending', priority: task.priority, payload,
      });
    }

    await db.insert(researchLog).values({
      eventType: 'generate_work', agentType: 'rektor',
      details: { reasoning: response.data.reasoning, tasksGenerated: response.data.tasks.length },
    });

    console.log(`Generated ${response.data.tasks.length} new tasks.`);
  }

  // ── Helpers ──────────────────────────

  private getAgent(agentType: string): BaseAgent {
    if (this.agents.has(agentType)) return this.agents.get(agentType)!;
    let agent: BaseAgent;
    switch (agentType) {
      case 'methodology-reader': agent = new MethodologyReader(this.config.agentLLM); break;
      case 'linguist': agent = new Linguist(this.config.agentLLM); break;
      default: throw new Error(`Unknown agent type: ${agentType}`);
    }
    this.agents.set(agentType, agent);
    return agent;
  }

  private async buildLinguistPayload(description: string): Promise<Record<string, unknown>> {
    try {
      const fbPath = resolve(import.meta.dirname, '../../../free-bible/generate');
      const fb = new FreeBible(fbPath);
      const bookId = 1;
      const chapterId = 1;
      const sourceChapter = await fb.getOriginalChapter(bookId, chapterId);
      const transChapter = await fb.getChapter('osnb2', bookId, chapterId);
      return {
        task: description,
        sourceText: sourceChapter.slice(0, 5).map(v => v.text).join(' '),
        translation: transChapter.slice(0, 5).map(v => v.text).join(' '),
        wordByWord: null,
      };
    } catch {
      return { task: description, sourceText: '', translation: '', wordByWord: null };
    }
  }
}
