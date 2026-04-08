import { BaseAgent, type AgentResult, type EvidenceStrength } from '../base-agent.js';
import { LLM } from '../../llm/llm.js';
import { PROMPTS } from '../../llm/prompts.js';

interface LinguistResult {
  wordAnalysis: Array<{ word: string; original: string; significance: string }>;
  grammaticalNotes: string[];
  intertextualConnections: Array<{ reference: string; sharedLanguage: string; significance: string }>;
  keyFinding: string;
  confidenceLevel: string;
}

export class Linguist extends BaseAgent {
  readonly type = 'linguist';
  private llm: LLM;

  constructor(llm: LLM) {
    super();
    this.llm = llm;
  }

  async execute(task: {
    task: string;
    sourceText: string;
    translation: string;
    wordByWord: unknown;
  }): Promise<AgentResult> {
    const prompt = LLM.formatPrompt(PROMPTS.LINGUIST, {
      task: task.task,
      sourceText: task.sourceText,
      translation: task.translation,
      wordByWord: task.wordByWord ? JSON.stringify(task.wordByWord) : 'Not available',
    });

    const response = await this.llm.callJSON<LinguistResult>(prompt);
    const strength = this.mapConfidence(response.data.confidenceLevel);

    return {
      finding: response.data.keyFinding,
      evidenceStrength: strength,
      reasoning: `Linguistic analysis found ${response.data.wordAnalysis.length} significant words, ${response.data.intertextualConnections.length} intertextual connections.`,
      sources: [{
        type: 'linguistic-analysis',
        reference: task.task,
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
