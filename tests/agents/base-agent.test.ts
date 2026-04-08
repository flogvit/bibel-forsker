import { describe, it, expect } from 'vitest';
import { BaseAgent, type AgentResult } from '../../src/agents/base-agent.js';

class TestAgent extends BaseAgent {
  readonly type = 'test-agent';

  async execute(task: { description: string }): Promise<AgentResult> {
    return {
      finding: `Processed: ${task.description}`,
      evidenceStrength: 'indication',
      reasoning: 'Test reasoning',
      sources: [],
    };
  }
}

describe('BaseAgent', () => {
  it('has a type identifier', () => {
    const agent = new TestAgent();
    expect(agent.type).toBe('test-agent');
  });

  it('execute returns an AgentResult', async () => {
    const agent = new TestAgent();
    const result = await agent.execute({ description: 'test task' });
    expect(result.finding).toBe('Processed: test task');
    expect(result.evidenceStrength).toBe('indication');
    expect(result.reasoning).toBe('Test reasoning');
    expect(result.sources).toEqual([]);
  });

  it('can serialize and restore state', () => {
    const agent = new TestAgent();
    agent.setState({ progress: 50, lastProcessed: 'Genesis 1' });
    const state = agent.getState();
    expect(state).toEqual({ progress: 50, lastProcessed: 'Genesis 1' });

    const agent2 = new TestAgent();
    agent2.setState(state);
    expect(agent2.getState()).toEqual(state);
  });
});
