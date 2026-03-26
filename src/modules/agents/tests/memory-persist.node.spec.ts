import { memoryPersistNode } from '../nodes/memory-persist.node';
import type { AgentState } from '../state/agent.state';

const mockUpsertVectorMemory = jest.fn();

const mockSearchVectorMemories = jest.fn().mockResolvedValue([]);

jest.mock('@vector-db/vector-memory.util', () => ({
  upsertVectorMemory: (...args: unknown[]) => mockUpsertVectorMemory(...args),
  searchVectorMemories: (...args: unknown[]) =>
    mockSearchVectorMemories(...args),
}));

function makeState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    input: 'test input',
    objective: 'test objective',
    finalAnswer: 'The final answer',
    sessionId: 'session-abc',
    ...overrides,
  } as AgentState;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUpsertVectorMemory.mockResolvedValue({
    id: 'uuid-1',
    vectorSize: 384,
    collection: 'agent_memory',
  });
});

describe('memoryPersistNode', () => {
  it('upserts finalAnswer and objective to vector DB', async () => {
    const state = makeState();
    await memoryPersistNode(state);

    expect(mockUpsertVectorMemory).toHaveBeenCalledTimes(1);
    expect(mockUpsertVectorMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Objective: test objective\nResult: The final answer',
        metadata: expect.objectContaining({
          sessionId: 'session-abc',
          type: 'agent_result',
        }),
      }),
    );
  });

  it('returns an empty object ({})', async () => {
    const state = makeState();
    const result = await memoryPersistNode(state);

    expect(result).toEqual({});
  });

  it('does not throw when upsertVectorMemory rejects', async () => {
    mockUpsertVectorMemory.mockRejectedValue(new Error('Qdrant unavailable'));

    const state = makeState();
    await expect(memoryPersistNode(state)).resolves.toEqual({});
  });
});
