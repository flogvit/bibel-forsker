import { describe, it, expect, vi } from 'vitest';
import { LLM, type LLMResponse } from '../src/llm/llm.js';

describe('LLM abstraction', () => {
  it('creates an LLM instance with claude provider', () => {
    const llm = new LLM({ provider: 'claude', model: 'claude-sonnet-4-6' });
    expect(llm.provider).toBe('claude');
    expect(llm.model).toBe('claude-sonnet-4-6');
  });

  it('creates an LLM instance with ollama provider', () => {
    const llm = new LLM({
      provider: 'ollama',
      model: 'qwen3.5:32b',
      baseUrl: 'http://localhost:11434',
    });
    expect(llm.provider).toBe('ollama');
    expect(llm.model).toBe('qwen3.5:32b');
  });

  it('formats a prompt with template variables', () => {
    const result = LLM.formatPrompt(
      'Analyze the word {{word}} in {{book}}',
      { word: 'hesed', book: 'Psalms' }
    );
    expect(result).toBe('Analyze the word hesed in Psalms');
  });

  it('formatPrompt handles missing variables gracefully', () => {
    const result = LLM.formatPrompt(
      'Analyze {{word}} in {{book}}',
      { word: 'hesed' }
    );
    expect(result).toBe('Analyze hesed in {{book}}');
  });
});
