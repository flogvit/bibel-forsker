import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Rektor } from '../src/rektor/rektor.js';

describe('Rektor', () => {
  it('can be created with a config', () => {
    const rektor = new Rektor({
      pollIntervalMs: 1000,
      researchRulesPath: 'research-rules.md',
    });
    expect(rektor).toBeDefined();
    expect(rektor.isRunning()).toBe(false);
  });

  it('starts and stops gracefully', async () => {
    const rektor = new Rektor({
      pollIntervalMs: 100,
      researchRulesPath: 'research-rules.md',
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
