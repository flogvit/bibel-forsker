import { BaseAgent, type AgentResult, type EvidenceStrength } from '../base-agent.js';
import { LLM } from '../../llm/llm.js';
import { PROMPTS } from '../../llm/prompts.js';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { readdir } from 'node:fs/promises';

export class Linguist extends BaseAgent {
  readonly type = 'linguist';
  private llm: LLM;

  constructor(llm: LLM) {
    super();
    this.llm = llm;
  }

  private async loadInstructions(): Promise<string> {
    const path = resolve(process.cwd(), 'research/agents/linguist.md');
    if (!existsSync(path)) return '';
    return readFile(path, 'utf-8');
  }

  private async loadRelevantMethods(): Promise<string> {
    const methodsDir = resolve(process.cwd(), 'research/methods');
    if (!existsSync(methodsDir)) return '';

    // Load hermeneutics and intertextual analysis — always relevant for linguist
    const relevant = ['hermeneutics.md', 'intertextual-analysis.md', 'textual-criticism.md'];
    const parts: string[] = [];

    for (const file of relevant) {
      const path = join(methodsDir, file);
      if (existsSync(path)) {
        parts.push(await readFile(path, 'utf-8'));
      }
    }

    return parts.join('\n\n---\n\n');
  }

  async execute(task: {
    task?: string;
    description?: string;
    sourceText: string;
    translation: string;
    wordByWord: unknown;
  }): Promise<AgentResult> {
    const instructions = await this.loadInstructions();
    const methods = await this.loadRelevantMethods();
    const taskDesc = task.task || task.description || 'unknown task';

    const prompt = LLM.formatPrompt(PROMPTS.LINGUIST, {
      agentInstructions: instructions,
      task: taskDesc,
      sourceText: task.sourceText || '(ikke tilgjengelig)',
      translation: task.translation || '(ikke tilgjengelig)',
      wordByWord: task.wordByWord ? JSON.stringify(task.wordByWord) : 'Ikke tilgjengelig',
      methods: methods || '(ingen metoder lastet)',
    });

    interface LinguistResult {
      wordAnalysis: Array<{ word: string; original: string; significance: string }>;
      grammaticalNotes: string[];
      intertextualConnections: Array<{ reference: string; sharedLanguage: string; significance: string }>;
      keyFinding: string;
      confidenceLevel: string;
    }

    const response = await this.llm.callJSON<LinguistResult>(prompt);
    const strength = this.mapConfidence(response.data.confidenceLevel);

    return {
      finding: response.data.keyFinding,
      evidenceStrength: strength,
      reasoning: `Lingvistisk analyse fant ${response.data.wordAnalysis.length} signifikante ord, ${response.data.intertextualConnections.length} intertekstuelle koblinger.`,
      sources: [{
        type: 'linguistic-analysis',
        reference: taskDesc,
        wordAnalysis: response.data.wordAnalysis,
        connections: response.data.intertextualConnections,
      }],
      metadata: {
        grammaticalNotes: response.data.grammaticalNotes,
        tokensUsed: response.tokensUsed,
      },
    };
  }

  private mapConfidence(level: string): EvidenceStrength {
    const map: Record<string, EvidenceStrength> = {
      speculation: 'speculation',
      indication: 'indication',
      strong_evidence: 'strong_evidence',
      proven: 'proven',
    };
    return map[level] ?? 'speculation';
  }
}
