import { chatNode } from './chat.node';
import type { AgentState } from '../state/agent.state';

jest.mock('@llm/llm.provider', () => ({
  invokeLlm: jest.fn(),
  streamLlm: jest.fn(),
}));

jest.mock('../prompts/agent.prompts', () => ({
  buildChatPrompt: jest.fn().mockReturnValue('prompt'),
}));

jest.mock('../state/agent-transition.util', () => ({
  completeAgentRun: jest
    .fn()
    .mockImplementation((answer) => ({ output: answer })),
}));

jest.mock('@utils/pretty-log.util', () => ({
  logPhaseStart: jest.fn(),
  logPhaseEnd: jest.fn(),
  startTimer: jest.fn().mockReturnValue(() => 0),
}));

const { invokeLlm, streamLlm } = require('@llm/llm.provider') as {
  invokeLlm: jest.Mock;
  streamLlm: jest.Mock;
};

function makeState(overrides: Partial<AgentState> = {}): AgentState {
  return { input: 'test input', ...overrides } as AgentState;
}

beforeEach(() => {
  jest.clearAllMocks();
  invokeLlm.mockResolvedValue('invoked answer');
});

describe('chatNode', () => {
  it('calls invokeLlm when onToken is not set', async () => {
    const state = makeState();
    await chatNode(state);

    expect(invokeLlm).toHaveBeenCalledWith('prompt', undefined, undefined, undefined, expect.any(String));
    expect(streamLlm).not.toHaveBeenCalled();
  });

  it('calls streamLlm when onToken is set and streamPhases is undefined', async () => {
    streamLlm.mockReturnValue(
      (async function* () {
        yield 'Hello';
        yield ' world';
      })(),
    );

    const onToken = jest.fn();
    const state = makeState({ onToken });
    await chatNode(state);

    expect(streamLlm).toHaveBeenCalledWith('prompt', undefined, undefined, undefined, expect.any(String));
    expect(invokeLlm).not.toHaveBeenCalled();
  });

  it('calls streamLlm when onToken is set and streamPhases includes "chat"', async () => {
    streamLlm.mockReturnValue(
      (async function* () {
        yield 'streamed';
      })(),
    );

    const onToken = jest.fn();
    const state = makeState({ onToken, streamPhases: ['chat', 'generate'] });
    await chatNode(state);

    expect(streamLlm).toHaveBeenCalledWith('prompt', undefined, undefined, undefined, expect.any(String));
    expect(invokeLlm).not.toHaveBeenCalled();
  });

  it('calls invokeLlm when onToken is set but streamPhases does not include "chat"', async () => {
    const onToken = jest.fn();
    const state = makeState({ onToken, streamPhases: ['generate'] });
    await chatNode(state);

    expect(invokeLlm).toHaveBeenCalledWith('prompt', undefined, undefined, undefined, expect.any(String));
    expect(streamLlm).not.toHaveBeenCalled();
  });

  it('calls onToken for each yielded token and assembles the full answer', async () => {
    const tokens = ['Hello', ' ', 'world'];
    streamLlm.mockReturnValue(
      (async function* () {
        for (const t of tokens) yield t;
      })(),
    );

    const onToken = jest.fn();
    const state = makeState({ onToken });
    const result = await chatNode(state);

    expect(onToken).toHaveBeenCalledTimes(3);
    expect(onToken).toHaveBeenNthCalledWith(1, 'Hello');
    expect(onToken).toHaveBeenNthCalledWith(2, ' ');
    expect(onToken).toHaveBeenNthCalledWith(3, 'world');
    expect(result).toEqual({ output: 'Hello world' });
  });

  it('skips empty tokens when streaming', async () => {
    streamLlm.mockReturnValue(
      (async function* () {
        yield 'Hi';
        yield '';
        yield '!';
      })(),
    );

    const onToken = jest.fn();
    const state = makeState({ onToken });
    const result = await chatNode(state);

    expect(onToken).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ output: 'Hi!' });
  });

  it('returns empty answer when streamLlm yields no non-empty tokens', async () => {
    streamLlm.mockReturnValue(
      (function* () {
        yield '';
        yield '';
      })(),
    );

    const onToken = jest.fn();
    const state = makeState({ onToken });
    const result = await chatNode(state);

    expect(result).toEqual({ output: '' });
  });
});
