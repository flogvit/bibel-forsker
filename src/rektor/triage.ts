import { LLM } from '../llm/llm.js';

export interface TriageResult {
  verdict: 'proceed' | 'split' | 'skip';
  reason: string;
  subtasks?: Array<{ agentType: string; description: string; priority: number }>;
}

const TRIAGE_PROMPT = `Du er en forsknings-triage-agent. Vurder om denne oppgaven er for bred.

VIKTIG: De fleste oppgaver er HÅNDTERBARE. Split KUN hvis oppgaven eksplisitt ber om:
- Analyse av en HEL BOK (f.eks. "analyser Jesaja" uten spesifikke vers)
- Sammenligning på tvers av MANGE bøker (f.eks. "alle Salmene")
- Mer enn 3 uavhengige forskningsspørsmål i én oppgave

IKKE split oppgaver som:
- Analyserer et kapittel eller noen vers (selv om det er mange spørsmål om SAMME passasje)
- Sammenligner to spesifikke passasjer
- Stiller ett spørsmål med flere underpunkter
- Er metodikk-lesing (disse er alltid håndterbare)

Standard er PROCEED. Vær i tvil, la oppgaven gå gjennom.

Oppgave: {{agentType}}: {{description}}

Svar med JSON:
\`\`\`json
{
  "verdict": "proceed|split|skip",
  "reason": "kort begrunnelse",
  "subtasks": []
}
\`\`\``;

export class Triage {
  private llm: LLM;

  constructor(llm: LLM) {
    this.llm = llm;
  }

  async evaluate(agentType: string, description: string): Promise<TriageResult> {
    // methodology-reader tasks are always manageable
    if (agentType === 'methodology-reader') {
      return { verdict: 'proceed', reason: 'Methodology tasks are always manageable' };
    }

    const prompt = LLM.formatPrompt(TRIAGE_PROMPT, {
      agentType,
      description,
    });

    try {
      const response = await this.llm.callJSON<TriageResult>(prompt);
      return response.data;
    } catch {
      return { verdict: 'proceed', reason: 'Triage failed, proceeding with original task' };
    }
  }
}
