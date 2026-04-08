import { BaseAgent, type AgentResult } from '../base-agent.js';
import { LLM } from '../../llm/llm.js';
import { PROMPTS } from '../../llm/prompts.js';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

interface MethodologyResult {
  methods: Array<{
    name: string;
    description: string;
    whenToUse: string;
    biblicalApplication: string;
  }>;
  qualityCriteria: string[];
  pitfalls: string[];
  keyInsight: string;
}

export class MethodologyReader extends BaseAgent {
  readonly type = 'methodology-reader';
  private llm: LLM;

  constructor(llm: LLM) {
    super();
    this.llm = llm;
  }

  private async loadInstructions(): Promise<string> {
    const path = resolve(process.cwd(), 'research/agents/methodology-reader.md');
    if (!existsSync(path)) return '';
    return readFile(path, 'utf-8');
  }

  async execute(task: { description: string; material: string }): Promise<AgentResult> {
    const instructions = await this.loadInstructions();

    const prompt = LLM.formatPrompt(PROMPTS.METHODOLOGY_READER, {
      agentInstructions: instructions,
      task: task.description,
      material: task.material,
    });

    const response = await this.llm.callJSON<MethodologyResult>(prompt);

    return {
      finding: response.data.keyInsight,
      evidenceStrength: 'indication',
      reasoning: `Analyserte materiale om "${task.description}". Fant ${response.data.methods.length} metoder, ${response.data.qualityCriteria.length} kvalitetskriterier, ${response.data.pitfalls.length} fallgruver.`,
      sources: [{ type: 'methodology', reference: task.description }],
      metadata: {
        methods: response.data.methods,
        qualityCriteria: response.data.qualityCriteria,
        pitfalls: response.data.pitfalls,
        tokensUsed: response.tokensUsed,
      },
    };
  }
}
