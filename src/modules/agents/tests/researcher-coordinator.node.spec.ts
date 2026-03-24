import { researcherCoordinatorNode } from '../nodes/researcher-coordinator.node';
import { AgentState } from '../state/agent.state';
import { AGENT_GRAPH_NODES } from '../graph/agent-topology';

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

// Mock Send to capture what it's called with
jest.mock('@langchain/langgraph', () => {
  return {
    ...jest.requireActual('@langchain/langgraph'),
    Send: jest.fn().mockImplementation((node: string, state: unknown) => ({
      node,
      args: state,
    })),
  };
});

const baseState: Partial<AgentState> = {
  input: 'test objective',
  phase: 'research',
  attempts: [],
};

describe('researcherCoordinatorNode', () => {
  it('returns an array of two Send objects', async () => {
    const result = await researcherCoordinatorNode(baseState as AgentState);

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
  });

  it('fans out to RESEARCH_FS and RESEARCH_VECTOR', async () => {
    const result = (await researcherCoordinatorNode(
      baseState as AgentState,
    )) as any[];

    const nodes = result.map((send) => send.node);
    expect(nodes).toContain(AGENT_GRAPH_NODES.RESEARCH_FS);
    expect(nodes).toContain(AGENT_GRAPH_NODES.RESEARCH_VECTOR);
  });

  it('passes the full state to each Send target', async () => {
    const result = (await researcherCoordinatorNode(
      baseState as AgentState,
    )) as any[];

    for (const send of result) {
      expect(send.args).toMatchObject({ input: 'test objective' });
    }
  });
});
