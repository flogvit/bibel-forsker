import { describe, it, expect, vi } from 'vitest';
import { Linguist } from '../../src/agents/forsker/linguist.js';
import { LLM } from '../../src/llm/llm.js';

describe('Linguist', () => {
  it('has correct agent type', () => {
    const agent = new Linguist({} as LLM);
    expect(agent.type).toBe('linguist');
  });

  it('analyzes verse data via LLM', async () => {
    const mockLLM = {
      callJSON: vi.fn().mockResolvedValue({
        text: 'response',
        tokensUsed: 200,
        model: 'test',
        data: {
          wordAnalysis: [{ word: 'hesed', original: 'חֶסֶד', significance: 'Covenant loyalty, mercy' }],
          grammaticalNotes: ['Construct chain emphasizes possession'],
          intertextualConnections: [{ reference: 'Psalm 136', sharedLanguage: 'hesed', significance: 'Repeated refrain' }],
          keyFinding: 'The use of hesed here connects to the broader covenant theology',
          confidenceLevel: 'strong_evidence',
        },
      }),
    } as unknown as LLM;

    const agent = new Linguist(mockLLM);
    const result = await agent.execute({
      task: 'Analyze Genesis 1:1',
      sourceText: 'בְּרֵאשִׁית בָּרָא אֱלֹהִים',
      translation: 'I begynnelsen skapte Gud',
      wordByWord: null,
    });

    expect(result.finding).toContain('covenant theology');
    expect(result.evidenceStrength).toBe('strong_evidence');
    expect(result.sources[0].type).toBe('linguistic-analysis');
  });
});
