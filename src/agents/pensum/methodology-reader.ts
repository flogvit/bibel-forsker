import { BaseAgent, type AgentResult } from '../base-agent.js';
import { LLM } from '../../llm/llm.js';
import { PROMPTS } from '../../llm/prompts.js';

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

  async execute(task: { description: string; material: string }): Promise<AgentResult> {
    const prompt = LLM.formatPrompt(PROMPTS.METHODOLOGY_READER, {
      task: task.description,
      material: task.material,
    });

    const response = await this.llm.callJSON<MethodologyResult>(prompt);

    return {
      finding: response.data.keyInsight,
      evidenceStrength: 'indication',
      reasoning: `Analyzed material about "${task.description}". Found ${response.data.methods.length} methods, ${response.data.qualityCriteria.length} quality criteria, ${response.data.pitfalls.length} pitfalls.`,
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
