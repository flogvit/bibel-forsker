import { Command } from 'commander';
import { Rektor } from './rektor/rektor.js';
import { LLM } from './llm/llm.js';
import { db, pool } from './db/connection.js';
import { agentTasks, findings, researchLog } from './db/schema.js';
import { loadState, saveState } from './rektor/state.js';
import { desc, eq, sql } from 'drizzle-orm';

const program = new Command();

program
  .name('bibel-forsker')
  .description('Autonomous AI Bible research system')
  .version('0.0.1');

program
  .command('start')
  .description('Start the research system')
  .option('--local', 'Use local Ollama for agent tasks (Rektor always uses Claude)')
  .option('--poll-interval <ms>', 'Poll interval in milliseconds', '10000')
  .action(async (opts) => {
    // Rektor always uses Claude (via claude -p CLI)
    const rektorLLM = new LLM({
      provider: 'claude',
      model: 'sonnet',
      allowedTools: ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch'],
    });

    // Agents use Ollama if --local, otherwise Claude
    const agentLLM = opts.local
      ? new LLM({
          provider: 'ollama',
          model: process.env.OLLAMA_MODEL ?? 'qwen3.5:32b',
          baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
        })
      : new LLM({
          provider: 'claude',
          model: 'sonnet',
          allowedTools: ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch'],
        });

    const rektor = new Rektor({
      pollIntervalMs: parseInt(opts.pollInterval),
      researchRulesPath: 'research-rules.md',
      rektorLLM,
      agentLLM,
    });

    const shutdown = async () => {
      console.log('\nShutting down gracefully...');
      await rektor.stop();
      await pool.close();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    rektor.start();
    console.log(`Rektor: Claude (always). Agents: ${opts.local ? 'Ollama' : 'Claude'}.`);
    console.log('Press Ctrl+C to stop.');
  });

program
  .command('stop')
  .description('Signal the system to stop')
  .action(async () => {
    const state = await loadState();
    state.running = false;
    await saveState(state);
    console.log('Stop signal sent. The system will stop on next cycle.');
    await pool.close();
  });

program
  .command('status')
  .description('Show current system status')
  .action(async () => {
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

    console.log('=== Bibel-Forsker Status ===');
    console.log(`Running: ${state.running}`);
    console.log(`Started: ${state.startedAt ?? 'never'}`);
    console.log(`Tasks completed: ${state.tasksCompleted}`);
    console.log(`Last reflection: ${state.lastReflection ?? 'never'}`);
    console.log(`Current focus: ${state.currentFocus ?? 'none'}`);
    console.log('');
    console.log('=== Task Queue ===');
    console.log(`Pending: ${taskCounts.pending}`);
    console.log(`In progress: ${taskCounts.inProgress}`);
    console.log(`Completed: ${taskCounts.completed}`);
    console.log(`Failed: ${taskCounts.failed}`);
    console.log('');
    console.log(`Total findings: ${findingCount.count}`);
    await pool.close();
  });

program
  .command('report')
  .description('Show latest findings')
  .option('-n <count>', 'Number of findings to show', '10')
  .action(async (opts) => {
    const limit = parseInt(opts.n);
    const recent = await db
      .select()
      .from(findings)
      .orderBy(desc(findings.createdAt))
      .limit(limit);

    if (recent.length === 0) {
      console.log('No findings yet.');
    } else {
      console.log(`=== Latest ${recent.length} Findings ===\n`);
      for (const f of recent) {
        console.log(`[${f.evidenceStrength}] ${f.agentType} (${f.createdAt.toISOString().slice(0, 16)})`);
        console.log(`  ${f.finding}`);
        console.log(`  Reasoning: ${f.reasoning}`);
        console.log('');
      }
    }
    await pool.close();
  });

program
  .command('comment <text>')
  .description('Add a comment/direction for the system')
  .action(async (text) => {
    await db.insert(researchLog).values({
      eventType: 'owner_comment',
      details: { comment: text, timestamp: new Date().toISOString() },
    });
    console.log('Comment recorded.');
    await pool.close();
  });

program
  .command('focus <topic>')
  .description('Set the current research focus')
  .action(async (topic) => {
    const state = await loadState();
    state.currentFocus = topic;
    await saveState(state);
    await db.insert(researchLog).values({
      eventType: 'focus_change',
      details: { topic, timestamp: new Date().toISOString() },
    });
    console.log(`Research focus set to: ${topic}`);
    await pool.close();
  });

program
  .command('seed')
  .description('Add initial tasks to get started')
  .action(async () => {
    const tasks = [
      {
        agentType: 'methodology-reader',
        payload: {
          description: 'Learn about the hermeneutic circle and its application to biblical research',
          material: 'The hermeneutic circle describes understanding as a reciprocal relationship between parts and whole. Schleiermacher: repeated circular movements between parts and whole. Dilthey: meaning is contextual, requires historical knowledge. Heidegger: fore-structures — we always have pre-understandings. Gadamer: understanding emerges through dialogue. Application: analyze a passage, understand context, return to passage with new understanding, repeat.',
        },
        priority: 1,
      },
      {
        agentType: 'methodology-reader',
        payload: {
          description: 'Learn about textual criticism methods for biblical manuscripts',
          material: 'Textual criticism examines biblical manuscripts to identify the original text. Key methods: manuscript comparison (Alexandrian, Western, Eastern text families), lectio brevior (shorter reading preferred), lectio difficilior (harder reading preferred), recension (selecting trustworthy evidence), emendation (eliminating errors). Tools: manuscript collation, stemmatic analysis, eclectic method.',
        },
        priority: 2,
      },
      {
        agentType: 'methodology-reader',
        payload: {
          description: 'Learn about grounded theory for discovering patterns in texts',
          material: 'Grounded theory builds theory from data bottom-up. Three coding stages: Open coding — analyze line-by-line, identify initial concepts. Axial coding — reconnect concepts by finding relationships (conditions, context, strategies, consequences). Selective coding — focus on core variable, reduce scope. Theoretical sampling: collect new data based on emerging concepts. Key: let patterns emerge rather than starting with hypotheses.',
        },
        priority: 3,
      },
    ];

    for (const task of tasks) {
      await db.insert(agentTasks).values({
        agentType: task.agentType,
        status: 'pending',
        priority: task.priority,
        payload: task.payload,
      });
    }

    console.log(`Seeded ${tasks.length} initial tasks.`);
    await pool.close();
  });

program.parse();
