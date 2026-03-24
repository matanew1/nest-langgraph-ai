import { researchVectorNode } from '../nodes/research-vector.node';
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

const mockBuildVectorResearchContext = jest.fn();

jest.mock('@vector-db/vector-memory.util', () => ({
  buildVectorResearchContext: (...args: unknown[]) =>
    mockBuildVectorResearchContext(...args),
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

describe('researchVectorNode', () => {
  afterEach(() => jest.clearAllMocks());

  beforeEach(() => {
    mockBuildVectorResearchContext.mockResolvedValue({
      text: '## Vector memory (Qdrant)\nRelevant memories: none found.',
      ids: [],
    });
  });

  it('returns memoryContext with vector search results', async () => {
    mockBuildVectorResearchContext.mockResolvedValue({
      text: '## Vector memory (Qdrant)\nFound 2 relevant memories.',
      ids: ['id-1', 'id-2'],
    });

    const result = await researchVectorNode(baseState as AgentState);

    expect(result.memoryContext).toContain('Vector memory');
    expect(result.vectorMemoryIds).toEqual(['id-1', 'id-2']);
  });

  it('does NOT set phase', async () => {
    const result = await researchVectorNode(baseState as AgentState);

    expect(result.phase).toBeUndefined();
  });

  it('does NOT write projectContext', async () => {
    const result = await researchVectorNode(baseState as AgentState);

    expect(result.projectContext).toBeUndefined();
  });

  it('includes session memory when present in state', async () => {
    const stateWithMemory = {
      ...baseState,
      sessionMemory: 'Remembered prior decision about X',
    } as AgentState;

    const result = await researchVectorNode(stateWithMemory);

    expect(result.memoryContext).toContain('Session memory');
    expect(result.memoryContext).toContain('Remembered prior decision about X');
  });

  it('adds vector warning error when vector search is unavailable', async () => {
    mockBuildVectorResearchContext.mockResolvedValue({
      text: '## Vector memory\n(unavailable: connection refused)',
      ids: [],
    });

    const result = await researchVectorNode(baseState as AgentState);

    expect(result.errors).toBeDefined();
    expect(result.errors).toHaveLength(1);
    expect(result.errors![0].code).toBe('tool_error');
  });

  it('does not add errors when vector search succeeds', async () => {
    const result = await researchVectorNode(baseState as AgentState);

    expect(result.errors).toBeUndefined();
  });

  it('calls buildVectorResearchContext with the current objective', async () => {
    const stateWithObjective = {
      ...baseState,
      objective: 'specific goal',
    } as AgentState;

    await researchVectorNode(stateWithObjective);

    expect(mockBuildVectorResearchContext).toHaveBeenCalledWith(
      'specific goal',
    );
  });

  it('falls back to input when objective is not set', async () => {
    await researchVectorNode(baseState as AgentState);

    expect(mockBuildVectorResearchContext).toHaveBeenCalledWith(
      'test objective',
    );
  });
});
