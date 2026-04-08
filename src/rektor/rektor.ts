import { db } from '../db/connection.js';
import { agentTasks, findings, researchLog } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { loadState, saveState, type RektorState } from './state.js';
import { Reflector } from './reflector.js';
import { LLM } from '../llm/llm.js';
import { MethodologyReader } from '../agents/pensum/methodology-reader.js';
import { Linguist } from '../agents/forsker/linguist.js';
import { type BaseAgent } from '../agents/base-agent.js';

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

    if (!task) return;

    // Mark in progress
    await db
      .update(agentTasks)
      .set({ status: 'in_progress', startedAt: new Date() })
      .where(eq(agentTasks.id, task.id));

    try {
      const agent = this.getAgent(task.agentType);
      const result = await agent.execute(task.payload as Record<string, unknown>);

      // Save finding
      await db.insert(findings).values({
        agentType: task.agentType,
        taskId: task.id,
        finding: result.finding,
        evidenceStrength: result.evidenceStrength,
        reasoning: result.reasoning,
        sources: result.sources,
        metadata: result.metadata ?? null,
      });

      // Mark complete
      await db
        .update(agentTasks)
        .set({ status: 'completed', result, completedAt: new Date() })
        .where(eq(agentTasks.id, task.id));

      // Log
      await db.insert(researchLog).values({
        eventType: 'task_completed',
        agentType: task.agentType,
        details: { taskId: task.id, finding: result.finding },
        tokensUsed: (result.metadata as Record<string, unknown>)?.tokensUsed as number ?? null,
      });

      this.tasksSinceReflection++;
      this.state.tasksCompleted++;
      await saveState(this.state);

      // Reflect periodically
      const reflectEvery = this.config.reflectEveryNTasks ?? 5;
      if (this.tasksSinceReflection >= reflectEvery) {
        await this.reflect();
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
        details: { taskId: task.id, error: message },
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
