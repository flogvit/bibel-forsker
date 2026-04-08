import { describe, it, expect, vi } from 'vitest';
import { MethodologyReader } from '../../src/agents/pensum/methodology-reader.js';
import { LLM } from '../../src/llm/llm.js';

describe('MethodologyReader', () => {
  it('has correct agent type', () => {
    const agent = new MethodologyReader({} as LLM);
    expect(agent.type).toBe('methodology-reader');
  });

  it('fetches and processes material via LLM', async () => {
    const mockLLM = {
      callJSON: vi.fn().mockResolvedValue({
        text: 'response',
        tokensUsed: 100,
        model: 'test',
        data: {
          methods: [{ name: 'Textual Criticism', description: 'Comparing manuscripts', whenToUse: 'When analyzing variants', biblicalApplication: 'Core to biblical studies' }],
          qualityCriteria: ['Reproducibility'],
          pitfalls: ['Confirmation bias'],
          keyInsight: 'Multiple methods strengthen findings',
        },
      }),
    } as unknown as LLM;

    const agent = new MethodologyReader(mockLLM);
    const result = await agent.execute({
      description: 'Learn about textual criticism',
      material: 'Textual criticism is the study of manuscript variants...',
    });

    expect(result.finding).toContain('Multiple methods');
    expect(result.evidenceStrength).toBe('indication');
    expect(mockLLM.callJSON).toHaveBeenCalledOnce();
  });
});
