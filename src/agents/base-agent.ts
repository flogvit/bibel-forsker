export type EvidenceStrength = 'speculation' | 'indication' | 'strong_evidence' | 'proven';

export interface AgentResult {
  finding: string;
  evidenceStrength: EvidenceStrength;
  reasoning: string;
  sources: Array<{ type: string; reference: string; [key: string]: unknown }>;
  metadata?: Record<string, unknown>;
}

export abstract class BaseAgent {
  abstract readonly type: string;
  private state: Record<string, unknown> = {};

  abstract execute(task: Record<string, unknown>): Promise<AgentResult>;

  getState(): Record<string, unknown> {
    return { ...this.state };
  }

  setState(state: Record<string, unknown>): void {
    this.state = { ...state };
  }
}
