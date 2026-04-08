// tests/integration.test.ts
import { describe, it, expect } from 'bun:test';
import { FreeBible } from '../src/data/free-bible.js';
import { LLM } from '../src/llm/llm.js';
import { BaseAgent, type AgentResult } from '../src/agents/base-agent.js';
import { MethodologyReader } from '../src/agents/pensum/methodology-reader.js';
import { Linguist } from '../src/agents/forsker/linguist.js';

describe('integration: components work together', () => {
  it('LLM.formatPrompt works with agent prompts', () => {
    const result = LLM.formatPrompt(
      'Analyze {{task}} with {{material}}',
      { task: 'hermeneutics', material: 'sample text' }
    );
    expect(result).toBe('Analyze hermeneutics with sample text');
  });

  it('agents are proper BaseAgent subclasses', () => {
    const mockLLM = {} as LLM;
    const reader = new MethodologyReader(mockLLM);
    const linguist = new Linguist(mockLLM);

    expect(reader).toBeInstanceOf(BaseAgent);
    expect(linguist).toBeInstanceOf(BaseAgent);
    expect(reader.type).toBe('methodology-reader');
    expect(linguist.type).toBe('linguist');
  });

  it('agent state serialization round-trips', () => {
    const mockLLM = {} as LLM;
    const agent = new MethodologyReader(mockLLM);
    agent.setState({ articlesRead: 5, lastUrl: 'https://example.com' });
    const state = agent.getState();
    expect(state).toEqual({ articlesRead: 5, lastUrl: 'https://example.com' });
  });
});
