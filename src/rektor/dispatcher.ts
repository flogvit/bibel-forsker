import { db } from '../db/connection.js';
import { agentTasks, findings, researchLog, library } from '../db/schema.js';
import { eq, desc, sql } from 'drizzle-orm';
import { LLM } from '../llm/llm.js';
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
import { runAllScouts } from '../agents/scout/scout.js';
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

  start(): void {
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

    // Priority 2: Pending research tasks
    const [task] = await db.select()
      .from(agentTasks)
      .where(eq(agentTasks.status, 'pending'))
      .orderBy(agentTasks.priority)
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

    // Priority 5: Generate new work if queue is empty
    const [pendingCount] = await db.select({ count: sql<number>`count(*)` })
      .from(agentTasks).where(eq(agentTasks.status, 'pending'));
    if (Number(pendingCount.count) === 0 && this.activeWorkers <= 1) {
      return {
        type: 'generate',
        priority: 5,
        run: () => this.runGenerateWork(),
      };
    }

    // Priority 6: Supervisor check every 5 min
    if (now - this.lastSupervisorTime > 300_000) {
      this.lastSupervisorTime = now;
      return {
        type: 'supervisor',
        priority: 6,
        run: () => this.runSupervisor(),
      };
    }

    // Priority 7: Scout every hour (new material doesn't appear every 10 min)
    if (now - this.lastScoutTime > 3_600_000) {
      this.lastScoutTime = now;
      return {
        type: 'scout',
        priority: 7,
        run: () => this.runScout(),
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
        finding: result.finding, evidenceStrength: result.evidenceStrength,
        reasoning: result.reasoning, sources: result.sources,
        metadata: { ...result.metadata ?? {}, reviewQuality },
      });

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

  private async runScout(): Promise<void> {
    await runAllScouts(this.config.rektorLLM);
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
