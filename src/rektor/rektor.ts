import { db } from '../db/connection.js';
import { agentTasks, findings, researchLog } from '../db/schema.js';
import { eq, desc, sql } from 'drizzle-orm';
import { loadState, saveState, type RektorState } from './state.js';
import { Reflector } from './reflector.js';
import { LLM } from '../llm/llm.js';
import { PROMPTS } from '../llm/prompts.js';
import { readResearchRules } from './state.js';
import { Triage } from './triage.js';
import { Reviewer } from './reviewer.js';
import { DiscoveryPipeline } from '../agents/discovery-pipeline.js';
import { MethodologyReader } from '../agents/pensum/methodology-reader.js';
import { Linguist } from '../agents/forsker/linguist.js';
import { type BaseAgent } from '../agents/base-agent.js';
import { FreeBible } from '../data/free-bible.js';
import { resolve } from 'node:path';

export interface RektorConfig {
  pollIntervalMs: number;
  researchRulesPath: string;
  rektorLLM: LLM;       // Always Claude — used for reflection and orchestration
  agentLLM: LLM;        // Claude or Ollama — used for agent tasks
  reflectEveryNTasks?: number;
}

export class Rektor {
  private config: RektorConfig;
  private running = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private state: RektorState | null = null;
  private agents: Map<string, BaseAgent> = new Map();
  private tasksSinceReflection = 0;
  private tasksSinceDiscoveryScan = 0;

  constructor(config: RektorConfig) {
    this.config = config;
  }

  isRunning(): boolean {
    return this.running;
  }

  start(): void {
    this.running = true;
    this.timer = setInterval(() => {
      this.processOnce().catch((err) => {
        console.error('Rektor loop error:', err);
      });
    }, this.config.pollIntervalMs);
    console.log('Rektor started.');
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.state) {
      this.state.running = false;
      await saveState(this.state);
    }
    console.log('Rektor stopped.');
  }

  async processOnce(): Promise<void> {
    if (!this.state) {
      this.state = await loadState();
      this.state.running = true;
      this.state.startedAt = new Date().toISOString();
      await saveState(this.state);
    }

    // Pick next pending task
    const [task] = await db
      .select()
      .from(agentTasks)
      .where(eq(agentTasks.status, 'pending'))
      .orderBy(agentTasks.priority)
      .limit(1);

    if (!task) {
      await this.generateWork();
      return;
    }

    const taskDescription = (task.payload as Record<string, unknown>)?.description
      ?? (task.payload as Record<string, unknown>)?.task
      ?? 'unknown task';

    // === TRIAGE: Is this task too broad? ===
    try {
      const triage = new Triage(this.config.rektorLLM);
      const triageResult = await triage.evaluate(task.agentType, String(taskDescription));

      if (triageResult.verdict === 'split' && triageResult.subtasks?.length) {
        // Replace broad task with focused subtasks
        for (const sub of triageResult.subtasks) {
          const payload = sub.agentType === 'methodology-reader'
            ? { description: sub.description, material: sub.description }
            : await this.buildLinguistPayload(sub.description);
          await db.insert(agentTasks).values({
            agentType: sub.agentType,
            status: 'pending',
            priority: sub.priority,
            payload,
          });
        }
        await db.update(agentTasks)
          .set({ status: 'completed', result: { triaged: 'split', subtasks: triageResult.subtasks.length }, completedAt: new Date() })
          .where(eq(agentTasks.id, task.id));
        await db.insert(researchLog).values({
          eventType: 'task_split',
          agentType: task.agentType,
          details: { taskId: task.id, description: taskDescription, reason: triageResult.reason, subtasks: triageResult.subtasks.length },
        });
        console.log(`Split task ${task.id}: ${triageResult.reason} → ${triageResult.subtasks.length} subtasks`);
        return;
      }

      if (triageResult.verdict === 'skip') {
        await db.update(agentTasks)
          .set({ status: 'completed', result: { triaged: 'skipped', reason: triageResult.reason }, completedAt: new Date() })
          .where(eq(agentTasks.id, task.id));
        await db.insert(researchLog).values({
          eventType: 'task_skipped',
          agentType: task.agentType,
          details: { taskId: task.id, description: taskDescription, reason: triageResult.reason },
        });
        return;
      }
    } catch (triageError) {
      // Triage failed — proceed anyway
      console.error('Triage error (proceeding):', triageError instanceof Error ? triageError.message : triageError);
    }

    // === EXECUTE ===
    await db
      .update(agentTasks)
      .set({ status: 'in_progress', startedAt: new Date() })
      .where(eq(agentTasks.id, task.id));

    try {
      const agent = this.getAgent(task.agentType);
      const result = await agent.execute(task.payload as Record<string, unknown>);

      // === REVIEW: Is the result good enough? ===
      let reviewQuality = 'unreviewed';
      try {
        const reviewer = new Reviewer(this.config.rektorLLM);
        const review = await reviewer.review(String(taskDescription), result);
        reviewQuality = review.quality;

        if (!review.approved) {
          await db.insert(researchLog).values({
            eventType: 'review_rejected',
            agentType: task.agentType,
            details: {
              taskId: task.id,
              description: taskDescription,
              quality: review.quality,
              issues: review.issues,
              suggestions: review.suggestions,
            },
          });
          // Still save the finding but mark as low quality
          result.evidenceStrength = 'speculation';
        }

        // Queue follow-up tasks from reviewer suggestions
        if (review.suggestions.length > 0) {
          for (const suggestion of review.suggestions.slice(0, 2)) {
            await db.insert(agentTasks).values({
              agentType: task.agentType,
              status: 'pending',
              priority: (task.priority ?? 0) + 1,
              payload: task.agentType === 'methodology-reader'
                ? { description: suggestion, material: suggestion }
                : { task: suggestion, sourceText: '', translation: '', wordByWord: null },
            });
          }
        }
      } catch (reviewError) {
        console.error('Review error (proceeding):', reviewError instanceof Error ? reviewError.message : reviewError);
      }

      // Save finding
      await db.insert(findings).values({
        agentType: task.agentType,
        taskId: task.id,
        finding: result.finding,
        evidenceStrength: result.evidenceStrength,
        reasoning: result.reasoning,
        sources: result.sources,
        metadata: { ...result.metadata ?? {}, reviewQuality },
      });

      // Mark complete
      await db
        .update(agentTasks)
        .set({ status: 'completed', result, completedAt: new Date() })
        .where(eq(agentTasks.id, task.id));

      await db.insert(researchLog).values({
        eventType: 'task_completed',
        agentType: task.agentType,
        details: {
          taskId: task.id,
          description: taskDescription,
          finding: result.finding,
          evidenceStrength: result.evidenceStrength,
          reviewQuality,
        },
        tokensUsed: (result.metadata as Record<string, unknown>)?.tokensUsed as number ?? null,
      });

      this.tasksSinceReflection++;
      this.tasksSinceDiscoveryScan++;
      this.state.tasksCompleted++;
      await saveState(this.state);

      // Reflect periodically
      const reflectEvery = this.config.reflectEveryNTasks ?? 3;
      if (this.tasksSinceReflection >= reflectEvery) {
        await this.reflect();
      }

      // Scan for discoveries every 10 tasks
      if (this.tasksSinceDiscoveryScan >= 10) {
        this.tasksSinceDiscoveryScan = 0;
        try {
          const pipeline = new DiscoveryPipeline(this.config.rektorLLM);
          await pipeline.scanForDiscoveries();
        } catch (e) {
          console.error('Discovery scan error:', e instanceof Error ? e.message : e);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db
        .update(agentTasks)
        .set({ status: 'failed', error: message, completedAt: new Date() })
        .where(eq(agentTasks.id, task.id));

      await db.insert(researchLog).values({
        eventType: 'task_failed',
        agentType: task.agentType,
        details: { taskId: task.id, description: taskDescription, error: message },
      });
    }
  }

  private getAgent(agentType: string): BaseAgent {
    if (this.agents.has(agentType)) return this.agents.get(agentType)!;

    let agent: BaseAgent;
    switch (agentType) {
      case 'methodology-reader':
        agent = new MethodologyReader(this.config.agentLLM);
        break;
      case 'linguist':
        agent = new Linguist(this.config.agentLLM);
        break;
      default:
        throw new Error(`Unknown agent type: ${agentType}`);
    }

    this.agents.set(agentType, agent);
    return agent;
  }

  private async buildLinguistPayload(description: string): Promise<Record<string, unknown>> {
    // Try to extract a book/chapter/verse reference from the description
    // and fetch real Bible data. Fall back to description-only if no data found.
    try {
      const fbPath = resolve(import.meta.dirname, '../../../free-bible/generate');
      const fb = new FreeBible(fbPath);

      // Pick a random interesting verse if no specific reference given
      const bookId = 1; // Genesis as default
      const chapterId = 1;
      const sourceChapter = await fb.getOriginalChapter(bookId, chapterId);
      const transChapter = await fb.getChapter('osnb2', bookId, chapterId);

      // Take first 5 verses for analysis
      const sourceText = sourceChapter.slice(0, 5).map(v => v.text).join(' ');
      const translation = transChapter.slice(0, 5).map(v => v.text).join(' ');

      return {
        task: description,
        sourceText,
        translation,
        wordByWord: null,
      };
    } catch {
      return {
        task: description,
        sourceText: '(source text not available)',
        translation: '(translation not available)',
        wordByWord: null,
      };
    }
  }

  private async generateWork(): Promise<void> {
    // Check if we recently generated work (avoid spamming)
    const [recentGen] = await db
      .select()
      .from(researchLog)
      .where(eq(researchLog.eventType, 'generate_work'))
      .orderBy(desc(researchLog.createdAt))
      .limit(1);

    if (recentGen) {
      const timeSince = Date.now() - recentGen.createdAt.getTime();
      if (timeSince < 300_000) return; // Don't generate more than once per 5 minutes
    }

    console.log('Queue empty — generating new research tasks...');

    const rules = await readResearchRules(this.config.researchRulesPath);
    const recentFindings = await db
      .select()
      .from(findings)
      .orderBy(desc(findings.createdAt))
      .limit(10);

    const prompt = LLM.formatPrompt(PROMPTS.REKTOR_GENERATE_WORK, {
      researchRules: rules,
      previousFindings: recentFindings.length > 0
        ? recentFindings.map(f => `[${f.evidenceStrength}] ${f.agentType}: ${f.finding}`).join('\n\n')
        : '(no findings yet)',
      currentFocus: this.state?.currentFocus ?? 'none — explore broadly',
    });

    try {
      const response = await this.config.rektorLLM.callJSON<{
        reasoning: string;
        tasks: Array<{ agentType: string; description: string; priority: number }>;
      }>(prompt);

      for (const task of response.data.tasks) {
        let payload: Record<string, unknown>;
        if (task.agentType === 'methodology-reader') {
          payload = { description: task.description, material: task.description };
        } else if (task.agentType === 'linguist') {
          payload = await this.buildLinguistPayload(task.description);
        } else {
          payload = { description: task.description };
        }

        await db.insert(agentTasks).values({
          agentType: task.agentType,
          status: 'pending',
          priority: task.priority,
          payload,
        });
      }

      await db.insert(researchLog).values({
        eventType: 'generate_work',
        agentType: 'rektor',
        details: {
          reasoning: response.data.reasoning,
          tasksGenerated: response.data.tasks.length,
          taskTypes: response.data.tasks.map(t => t.agentType),
        },
      });

      console.log(`Generated ${response.data.tasks.length} new tasks.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Failed to generate work:', message);
      await db.insert(researchLog).values({
        eventType: 'generate_work_failed',
        agentType: 'rektor',
        details: { error: message },
      });
    }
  }

  private async reflect(): Promise<void> {
    const recentFindings = await db
      .select()
      .from(findings)
      .orderBy(findings.createdAt)
      .limit(10);

    const reflector = new Reflector(this.config.rektorLLM, this.config.researchRulesPath);
    const reflection = await reflector.reflect(
      recentFindings.map((f) => ({ agentType: f.agentType, result: f.finding }))
    );

    // Queue new tasks from reflection
    for (const next of reflection.nextTasks) {
      await db.insert(agentTasks).values({
        agentType: next.agentType,
        status: 'pending',
        priority: next.priority,
        payload: { description: next.description },
      });
    }

    await db.insert(researchLog).values({
      eventType: 'reflection',
      agentType: 'rektor',
      details: {
        learnings: reflection.learnings,
        effectiveMethods: reflection.effectiveMethods,
        newTasks: reflection.nextTasks.length,
        rulesUpdated: !!reflection.rulesUpdate,
      },
    });

    this.tasksSinceReflection = 0;
    this.state!.lastReflection = new Date().toISOString();
    await saveState(this.state!);
  }
}
