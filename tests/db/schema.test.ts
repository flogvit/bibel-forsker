import { describe, it, expect } from 'vitest';
import {
  agentTasks,
  findings,
  researchLog,
  agentState,
  pensumArticles,
} from '../../src/db/schema.js';

describe('database schema', () => {
  it('agentTasks has required columns', () => {
    expect(agentTasks.id).toBeDefined();
    expect(agentTasks.agentType).toBeDefined();
    expect(agentTasks.status).toBeDefined();
    expect(agentTasks.payload).toBeDefined();
    expect(agentTasks.result).toBeDefined();
    expect(agentTasks.createdAt).toBeDefined();
    expect(agentTasks.startedAt).toBeDefined();
    expect(agentTasks.completedAt).toBeDefined();
  });

  it('findings has required columns', () => {
    expect(findings.id).toBeDefined();
    expect(findings.agentType).toBeDefined();
    expect(findings.finding).toBeDefined();
    expect(findings.evidenceStrength).toBeDefined();
    expect(findings.reasoning).toBeDefined();
    expect(findings.sources).toBeDefined();
    expect(findings.createdAt).toBeDefined();
  });

  it('researchLog has required columns', () => {
    expect(researchLog.id).toBeDefined();
    expect(researchLog.eventType).toBeDefined();
    expect(researchLog.agentType).toBeDefined();
    expect(researchLog.details).toBeDefined();
    expect(researchLog.tokensUsed).toBeDefined();
    expect(researchLog.createdAt).toBeDefined();
  });

  it('agentState has required columns', () => {
    expect(agentState.id).toBeDefined();
    expect(agentState.agentType).toBeDefined();
    expect(agentState.state).toBeDefined();
    expect(agentState.updatedAt).toBeDefined();
  });

  it('pensumArticles has required columns', () => {
    expect(pensumArticles.id).toBeDefined();
    expect(pensumArticles.url).toBeDefined();
    expect(pensumArticles.title).toBeDefined();
    expect(pensumArticles.summary).toBeDefined();
    expect(pensumArticles.keyLearnings).toBeDefined();
    expect(pensumArticles.processedAt).toBeDefined();
  });
});
