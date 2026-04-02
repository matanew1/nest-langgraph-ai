import { memoryPersistNode } from './memory-persist.node';
import type { AgentState } from '@state/agent.state';
import { createHash } from 'node:crypto';

jest.mock('@vector-db/vector-memory.util', () => ({
  upsertVectorMemory: jest.fn(),
}));

jest.mock('@nestjs/common', () => ({
  Logger: jest.fn(() => ({
    log: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  })),
}));

const { upsertVectorMemory } = require('@vector-db/vector-memory.util') as {
  upsertVectorMemory: jest.Mock;
};

function makeState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    sessionId: 'test-session',
    input: 'test input',
    objective: 'test objective',
    finalAnswer: 'test result',
    ...overrides,
  } as AgentState;
}

beforeEach(() => {
  jest.clearAllMocks();
  upsertVectorMemory.mockResolvedValue(undefined);
});

describe('memoryPersistNode', () => {
  it('upserts objective and finalAnswer to vector memory', async () => {
    const baseState = makeState();
    await memoryPersistNode(baseState);

    const hex = createHash('sha256')
      .update(JSON.stringify({ objective: 'test objective', finalAnswer: 'test result' }))
      .digest('hex');
    const expectedId = [hex.slice(0,8), hex.slice(8,12), hex.slice(12,16), hex.slice(16,20), hex.slice(20,32)].join('-');

    expect(upsertVectorMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expectedId,
        text: expect.stringContaining('Objective: test objective'),
        metadata: expect.objectContaining({
          sessionId: 'test-session',
          type: 'agent_result',
        }),
      }),
    );
    expect(upsertVectorMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('Result: test result'),
      }),
    );
  });

  it('uses state.input when objective is undefined', async () => {
    const stateWithoutObjective = makeState({ objective: undefined });
    await memoryPersistNode(stateWithoutObjective);

    expect(upsertVectorMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('Objective: test input'),
      }),
    );
  });

  it('skips persistence when finalAnswer is undefined', async () => {
    const stateWithoutAnswer = makeState({ finalAnswer: undefined });
    await memoryPersistNode(stateWithoutAnswer);

    expect(upsertVectorMemory).not.toHaveBeenCalled();
  });

  it('returns empty object on success', async () => {
    const baseState = makeState();
    const result = await memoryPersistNode(baseState);

    expect(result).toEqual({});
  });

  it('catches and logs errors without propagating', async () => {
    const error = new Error('Vector DB failure');
    upsertVectorMemory.mockRejectedValue(error);

    const baseState = makeState();
    const result = await memoryPersistNode(baseState);

    expect(result).toEqual({});
  });
});
