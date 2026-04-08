import { LLM } from '../llm/llm.js';

export interface TriageResult {
  verdict: 'proceed' | 'split' | 'skip';
  reason: string;
  subtasks?: Array<{ agentType: string; description: string; priority: number }>;
}

const TRIAGE_PROMPT = `Du er en forsknings-triage-agent. Din jobb er å vurdere om en forskningsoppgave er håndterbar eller for bred.

En oppgave er FOR BRED hvis den:
- Ber om analyse av en hel bok eller mange kapitler
- Ber om å sammenligne et ord "på tvers av" mange bøker
- Inneholder flere uavhengige forskningsspørsmål i én oppgave
- Ville kreve mer enn 2-3 minutter å svare grundig på

En oppgave er HÅNDTERBAR hvis den:
- Fokuserer på én spesifikk passasje (noen få vers)
- Stiller ett klart forskningsspørsmål
- Kan besvares med én analyse

Oppgave å vurdere:
Agenttype: {{agentType}}
Beskrivelse: {{description}}

Hvis oppgaven er for bred, del den i 2-4 konkrete, avgrenset deloppgaver.
Hvis oppgaven er håndterbar, svar "proceed".
Hvis oppgaven er meningsløs eller duplikat, svar "skip".

Svar med JSON:
\`\`\`json
{
  "verdict": "proceed|split|skip",
  "reason": "kort begrunnelse",
  "subtasks": [{"agentType": "string", "description": "string", "priority": 0}]
}
\`\`\``;

export class Triage {
  private llm: LLM;

  constructor(llm: LLM) {
    this.llm = llm;
  }

  async evaluate(agentType: string, description: string): Promise<TriageResult> {
    const prompt = LLM.formatPrompt(TRIAGE_PROMPT, {
      agentType,
      description,
    });

    try {
      const response = await this.llm.callJSON<TriageResult>(prompt);
      return response.data;
    } catch {
      // If triage fails, just proceed with the original task
      return { verdict: 'proceed', reason: 'Triage failed, proceeding with original task' };
    }
  }
}
