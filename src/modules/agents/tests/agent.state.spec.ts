jest.mock('@config/env', () => ({
  env: {
    mistralTimeoutMs: 5000,
    promptMaxAttempts: 5,
    agentWorkingDir: '/tmp',
    chatMemoryMaxChars: 4000,
    researcherTreeMaxLines: 200,
    rawResultMaxBytes: 8192,
    attemptsHistoryCap: 10,
    errorsHistoryCap: 10,
    checkpointHistoryLimit: 5,
  },
}));

import { AgentStateAnnotation } from '../state/agent.state';

describe('AgentStateAnnotation', () => {
  it('does not contain removed jsonRepair fields', () => {
    const keys = Object.keys(AgentStateAnnotation.spec);
    expect(keys).not.toContain('jsonRepair');
    expect(keys).not.toContain('jsonRepairResult');
    expect(keys).not.toContain('jsonRepairFromPhase');
  });

  it('contains all expected current state fields', () => {
    const keys = Object.keys(AgentStateAnnotation.spec);
    expect(keys).toContain('input');
    expect(keys).toContain('phase');
    expect(keys).toContain('plan');
    expect(keys).toContain('counters');
    expect(keys).toContain('errors');
    expect(keys).toContain('attempts');
  });
});
