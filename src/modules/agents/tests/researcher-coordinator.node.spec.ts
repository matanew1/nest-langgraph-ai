import { researcherCoordinatorNode } from '../nodes/researcher-coordinator.node';
import { AgentState } from '../state/agent.state';

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
  input: 'test objective',
  phase: 'research',
  attempts: [],
};

describe('researcherCoordinatorNode', () => {
  it('returns an empty state delta (fan-out is handled by graph edges)', async () => {
    const result = await researcherCoordinatorNode(baseState as AgentState);
    expect(result).toEqual({});
  });

  it('does not mutate the input state', async () => {
    const stateBefore = { ...baseState };
    await researcherCoordinatorNode(baseState as AgentState);
    expect(baseState).toEqual(stateBefore);
  });
});
