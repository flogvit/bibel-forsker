import { describe, it, expect, vi, beforeEach } from 'bun:test';
import { Rektor } from '../src/rektor/rektor.js';
import { LLM } from '../src/llm/llm.js';

const mockLLM = {} as LLM;

describe('Rektor', () => {
  it('can be created with a config', () => {
    const rektor = new Rektor({
      pollIntervalMs: 1000,
      researchRulesPath: 'research-rules.md',
      rektorLLM: mockLLM,
      agentLLM: mockLLM,
    });
    expect(rektor).toBeDefined();
    expect(rektor.isRunning()).toBe(false);
  });

  it('starts and stops gracefully', async () => {
    const rektor = new Rektor({
      pollIntervalMs: 100,
      researchRulesPath: 'research-rules.md',
      rektorLLM: mockLLM,
      agentLLM: mockLLM,
    });

    const processOnce = vi.spyOn(rektor, 'processOnce').mockResolvedValue();

    rektor.start();
    expect(rektor.isRunning()).toBe(true);

    await new Promise((r) => setTimeout(r, 150));
    expect(processOnce).toHaveBeenCalled();

    await rektor.stop();
    expect(rektor.isRunning()).toBe(false);
  });
});
