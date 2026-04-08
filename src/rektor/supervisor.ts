import { db } from '../db/connection.js';
import { agentTasks, researchLog, findings } from '../db/schema.js';
import { desc, sql, eq } from 'drizzle-orm';
import { LLM } from '../llm/llm.js';

const DIAGNOSE_PROMPT = `Du er supervisor for et bibelforskning-system. Analyser disse feilene og foreslå tiltak.

Feil fra siste periode:
{{errors}}

Systemstatistikk:
- Fullførte oppgaver: {{completed}}
- Feilede oppgaver: {{failed}}
- Ventende oppgaver: {{pending}}
- Funn totalt: {{findings}}

Vanlige feiltyper:
- "JSON Parse error" = Claude returnerte ugyldig/avkuttet JSON (oppgaven var for bred)
- "max turns" = Claude brukte for mange verktøykall (oppgaven var for kompleks)
- "claude exited with code 1" = Claude CLI feilet

Hva bør vi gjøre? Mulige tiltak:
1. Slett oppgaver som feiler gjentatte ganger (de er for brede)
2. Foreslå endringer i research/strategy.md
3. Foreslå nye forskningsretninger basert på hva som fungerer
4. Rapporter om systemhelse

Svar på norsk med JSON:
\`\`\`json
{
  "diagnosis": "kort oppsummering av situasjonen",
  "actions": [
    {"type": "delete_failed", "reason": "hvorfor"},
    {"type": "observation", "text": "noe viktig å merke seg"}
  ],
  "systemHealth": "healthy|degraded|critical",
  "recommendations": ["forbedringsforslag"]
}
\`\`\``;

interface SupervisorAction {
  type: 'delete_failed' | 'observation' | 'adjust_strategy';
  reason?: string;
  text?: string;
}

interface SupervisorResult {
  diagnosis: string;
  actions: SupervisorAction[];
  systemHealth: string;
  recommendations: string[];
}

export class Supervisor {
  private llm: LLM;

  constructor(llm: LLM) {
    this.llm = llm;
  }

  async check(): Promise<void> {
    // Gather error stats
    const failedTasks = await db
      .select()
      .from(agentTasks)
      .where(eq(agentTasks.status, 'failed'))
      .orderBy(desc(agentTasks.completedAt))
      .limit(10);

    if (failedTasks.length === 0) {
      // No errors — just log health check
      const [taskStats] = await db.select({
        pending: sql<number>`count(*) filter (where status = 'pending')`,
        completed: sql<number>`count(*) filter (where status = 'completed')`,
      }).from(agentTasks);

      const [findingStats] = await db.select({
        count: sql<number>`count(*)`,
      }).from(findings);

      await db.insert(researchLog).values({
        eventType: 'supervisor_check',
        agentType: 'supervisor',
        details: {
          status: 'healthy',
          pending: Number(taskStats.pending),
          completed: Number(taskStats.completed),
          findings: Number(findingStats.count),
          errors: 0,
        },
      });
      return;
    }

    // We have errors — diagnose
    const errorSummaries = failedTasks.map(t => {
      const desc = (t.payload as Record<string, unknown>)?.description
        ?? (t.payload as Record<string, unknown>)?.task ?? 'unknown';
      return `Task ${t.id} (${t.agentType}): ${String(desc).slice(0, 100)} → ${(t.error ?? '').slice(0, 150)}`;
    }).join('\n');

    const [stats] = await db.select({
      pending: sql<number>`count(*) filter (where status = 'pending')`,
      completed: sql<number>`count(*) filter (where status = 'completed')`,
      failed: sql<number>`count(*) filter (where status = 'failed')`,
    }).from(agentTasks);

    const [findingStats] = await db.select({
      count: sql<number>`count(*)`,
    }).from(findings);

    const prompt = LLM.formatPrompt(DIAGNOSE_PROMPT, {
      errors: errorSummaries,
      completed: String(stats.completed),
      failed: String(stats.failed),
      pending: String(stats.pending),
      findings: String(findingStats.count),
    });

    try {
      const response = await this.llm.callJSON<SupervisorResult>(prompt);
      const result = response.data;

      // Execute actions
      for (const action of result.actions) {
        if (action.type === 'delete_failed') {
          // Clean up persistently failing tasks
          const deleted = await db.delete(agentTasks)
            .where(eq(agentTasks.status, 'failed'))
            .returning();
          console.log(`Supervisor: deleted ${deleted.length} failed tasks. ${action.reason}`);
        }
      }

      await db.insert(researchLog).values({
        eventType: 'supervisor_check',
        agentType: 'supervisor',
        details: {
          diagnosis: result.diagnosis,
          systemHealth: result.systemHealth,
          actions: result.actions,
          recommendations: result.recommendations,
          errorsFound: failedTasks.length,
        },
      });

      console.log(`Supervisor: ${result.systemHealth} — ${result.diagnosis}`);
    } catch (e) {
      console.error('Supervisor check failed:', e instanceof Error ? e.message : e);
    }
  }
}
