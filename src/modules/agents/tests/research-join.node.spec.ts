import { researchJoinNode } from '../nodes/research-join.node';
import { AgentState } from '../state/agent.state';
import { AGENT_PHASES } from '../state/agent-phase';

jest.mock('@config/env', () => ({
  env: {
    mistralTimeoutMs: 5000,
    agentMaxRetries: 0,
  },
}));

jest.mock('@llm/llm.provider', () => ({
  invokeLlm: jest.fn(),
}));

jest.mock('@vector-db/vector-memory.util', () => ({
  buildVectorResearchContext: jest.fn(),
}));

jest.mock('../tools/index', () => ({
  toolRegistry: {
    get: jest.fn(),
  },
}));

const baseState: Partial<AgentState> = {
  input: 'test',
  phase: 'research',
  projectContext: 'gathered fs context',
  memoryContext: 'gathered memory context',
  attempts: [],
};

describe('researchJoinNode', () => {
  it('transitions to plan phase', async () => {
    const result = await researchJoinNode(baseState as AgentState);

    expect(result.phase).toBe(AGENT_PHASES.PLAN);
  });

  it('does not modify projectContext or memoryContext', async () => {
    const result = await researchJoinNode(baseState as AgentState);

    expect(result.projectContext).toBeUndefined();
    expect(result.memoryContext).toBeUndefined();
  });

  it('works when state has no research context (graceful)', async () => {
    const emptyState: Partial<AgentState> = {
      input: 'test',
      phase: 'research',
      attempts: [],
    };

    const result = await researchJoinNode(emptyState as AgentState);

    expect(result.phase).toBe(AGENT_PHASES.PLAN);
  });
});
