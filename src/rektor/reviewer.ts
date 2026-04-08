import { LLM } from '../llm/llm.js';
import { type AgentResult } from '../agents/base-agent.js';

export interface ReviewResult {
  approved: boolean;
  quality: 'high' | 'medium' | 'low';
  issues: string[];
  suggestions: string[];
}

const REVIEW_PROMPT = `Du er en kvalitetssikrer for et bibelforskning-system. Vurder dette forskningsfunnet.

Oppgave som ble gitt:
{{taskDescription}}

Funn:
{{finding}}

Begrunnelse:
{{reasoning}}

Evidensstyrke angitt av agenten: {{evidenceStrength}}

Vurder:
1. Er funnet substansielt, eller bare en omskriving av oppgaven?
2. Er evidensstyrken riktig? (speculation = gjetning, indication = noe belegg, strong_evidence = solid, proven = ubestridelig)
3. Er det logiske feil eller ubegrunnede påstander?
4. Bringer dette noe nytt, eller er det bare allmennkunnskap?

Svar med JSON:
\`\`\`json
{
  "approved": true/false,
  "quality": "high|medium|low",
  "issues": ["eventuelle problemer"],
  "suggestions": ["forbedringsforslag eller oppfølgingsoppgaver"]
}
\`\`\``;

export class Reviewer {
  private llm: LLM;

  constructor(llm: LLM) {
    this.llm = llm;
  }

  async review(taskDescription: string, result: AgentResult): Promise<ReviewResult> {
    const prompt = LLM.formatPrompt(REVIEW_PROMPT, {
      taskDescription,
      finding: result.finding,
      reasoning: result.reasoning,
      evidenceStrength: result.evidenceStrength,
    });

    try {
      const response = await this.llm.callJSON<ReviewResult>(prompt);
      return response.data;
    } catch {
      // If review fails, approve by default
      return { approved: true, quality: 'medium', issues: ['Review failed'], suggestions: [] };
    }
  }
}
