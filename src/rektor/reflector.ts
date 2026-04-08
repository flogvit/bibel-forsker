import { LLM } from '../llm/llm.js';
import { PROMPTS } from '../llm/prompts.js';
import { readResearchRules } from './state.js';

interface ReflectionResult {
  learnings: string[];
  effectiveMethods: string[];
  nextTasks: Array<{ agentType: string; description: string; priority: number }>;
  rulesUpdate: string | null;
}

export class Reflector {
  private llm: LLM;
  private rulesPath: string;

  constructor(llm: LLM, rulesPath: string) {
    this.llm = llm;
    this.rulesPath = rulesPath;
  }

  async reflect(completedTasks: Array<{ agentType: string; result: string }>): Promise<ReflectionResult> {
    const rules = await readResearchRules(this.rulesPath);
    const prompt = LLM.formatPrompt(PROMPTS.REKTOR_REFLECT, {
      researchRules: rules,
      completedTasks: JSON.stringify(completedTasks, null, 2),
    });

    const response = await this.llm.callJSON<ReflectionResult>(prompt);

    // Strategy file is managed by the human, not by AI.
    // Reflections are logged but don't overwrite the file.

    return response.data;
  }
}
