import { generatorNode } from './generator.node';
import type { AgentState } from '../state/agent.state';

jest.mock('@llm/llm.provider', () => ({
  invokeLlm: jest.fn(),
  streamLlm: jest.fn(),
}));

jest.mock('../prompts/agent.prompts', () => ({
  buildGeneratorPrompt: jest.fn().mockReturnValue('prompt'),
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
  return { input: 'test input', attempts: [], ...overrides } as AgentState;
}

beforeEach(() => {
  jest.clearAllMocks();
  invokeLlm.mockResolvedValue('invoked answer');
});

describe('generatorNode', () => {
  it('calls invokeLlm when onToken is not set', async () => {
    const state = makeState();
    await generatorNode(state);

    expect(invokeLlm).toHaveBeenCalledWith('prompt');
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
    await generatorNode(state);

    expect(streamLlm).toHaveBeenCalledWith('prompt');
    expect(invokeLlm).not.toHaveBeenCalled();
  });

  it('calls streamLlm when onToken is set and streamPhases includes "generate"', async () => {
    streamLlm.mockReturnValue(
      (async function* () {
        yield 'streamed';
      })(),
    );

    const onToken = jest.fn();
    const state = makeState({ onToken, streamPhases: ['chat', 'generate'] });
    await generatorNode(state);

    expect(streamLlm).toHaveBeenCalledWith('prompt');
    expect(invokeLlm).not.toHaveBeenCalled();
  });

  it('calls invokeLlm when onToken is set but streamPhases does not include "generate"', async () => {
    const onToken = jest.fn();
    const state = makeState({ onToken, streamPhases: ['chat'] });
    await generatorNode(state);

    expect(invokeLlm).toHaveBeenCalledWith('prompt');
    expect(streamLlm).not.toHaveBeenCalled();
  });

  it('calls onToken for each yielded token and assembles the full answer', async () => {
    const tokens = ['Final', ' ', 'answer'];
    streamLlm.mockReturnValue(
      (async function* () {
        for (const t of tokens) yield t;
      })(),
    );

    const onToken = jest.fn();
    const state = makeState({ onToken });
    const result = await generatorNode(state);

    expect(onToken).toHaveBeenCalledTimes(3);
    expect(onToken).toHaveBeenNthCalledWith(1, 'Final');
    expect(onToken).toHaveBeenNthCalledWith(2, ' ');
    expect(onToken).toHaveBeenNthCalledWith(3, 'answer');
    expect(result).toEqual({ output: 'Final answer' });
  });

  it('skips empty tokens when streaming', async () => {
    streamLlm.mockReturnValue(
      (async function* () {
        yield 'Done';
        yield '';
        yield '!';
      })(),
    );

    const onToken = jest.fn();
    const state = makeState({ onToken });
    const result = await generatorNode(state);

    expect(onToken).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ output: 'Done!' });
  });
});
