import { generatorNode } from '../nodes/generator.node';
import { AgentState, Attempt } from '../state/agent.state';
import { invokeLlm } from '@llm/llm.provider';

jest.mock('@config/env', () => ({
  env: {
    mistralTimeoutMs: 5000,
    agentWorkingDir: '/tmp',
    promptMaxSummaryChars: 2000,
  },
}));

jest.mock('@llm/llm.provider', () => ({
  invokeLlm: jest.fn(),
}));

jest.mock('../prompts/agent.prompts', () => ({
  buildGeneratorPrompt: jest.fn().mockReturnValue('mock generator prompt'),
}));

const mockedInvokeLlm = jest.mocked(invokeLlm);

const makeAttempt = (step: number, result: string): Attempt => ({
  tool: 'search',
  step,
  params: { query: 'test' },
  result: {
    ok: true,
    kind: 'text',
    summary: result,
    preview: result,
    raw: result,
  },
});

const baseState: Partial<AgentState> = {
  input: 'Find and summarize data',
  objective: 'Find and summarize data',
  plan: [
    {
      step_id: 1,
      description: 'Search for data',
      tool: 'search',
      input: { query: 'data' },
    },
  ],
  attempts: [makeAttempt(1, 'Found relevant data about the topic')],
  currentStep: 0,
  errors: [],
  counters: {
    turn: 1,
    toolCalls: 1,
    replans: 0,
    stepRetries: 0,
    supervisorFallbacks: 0,
  },
};

describe('generatorNode', () => {
  afterEach(() => jest.clearAllMocks());

  it('transitions to complete phase with a final answer', async () => {
    mockedInvokeLlm.mockResolvedValue(
      'Here is the final answer based on the research.',
    );

    const result = await generatorNode(baseState as AgentState);

    expect(result.phase).toBe('complete');
    expect(result.finalAnswer).toBe(
      'Here is the final answer based on the research.',
    );
  });

  it('trims whitespace from the LLM answer', async () => {
    mockedInvokeLlm.mockResolvedValue('  \n  Answer with whitespace  \n  ');

    const result = await generatorNode(baseState as AgentState);

    expect(result.finalAnswer).toBe('Answer with whitespace');
    expect(result.phase).toBe('complete');
  });

  it('produces a non-empty string as finalAnswer', async () => {
    mockedInvokeLlm.mockResolvedValue('A well-formed answer.');

    const result = await generatorNode(baseState as AgentState);

    expect(typeof result.finalAnswer).toBe('string');
    expect(result.finalAnswer!.length).toBeGreaterThan(0);
  });

  it('handles empty attempts array gracefully', async () => {
    const stateWithNoAttempts: Partial<AgentState> = {
      ...baseState,
      attempts: [],
    };

    mockedInvokeLlm.mockResolvedValue('Answer based on no prior attempts.');

    const result = await generatorNode(stateWithNoAttempts as AgentState);

    expect(result.phase).toBe('complete');
    expect(result.finalAnswer).toBe('Answer based on no prior attempts.');
  });

  it('handles multiple attempts and still produces a final answer', async () => {
    const stateWithManyAttempts: Partial<AgentState> = {
      ...baseState,
      attempts: [
        makeAttempt(1, 'First result'),
        makeAttempt(2, 'Second result'),
        makeAttempt(3, 'Third result'),
      ],
    };

    mockedInvokeLlm.mockResolvedValue(
      'Comprehensive answer from all attempts.',
    );

    const result = await generatorNode(stateWithManyAttempts as AgentState);

    expect(result.phase).toBe('complete');
    expect(result.finalAnswer).toBe('Comprehensive answer from all attempts.');
  });

  it('calls invokeLlm exactly once', async () => {
    mockedInvokeLlm.mockResolvedValue('Answer.');

    await generatorNode(baseState as AgentState);

    expect(mockedInvokeLlm).toHaveBeenCalledTimes(1);
  });

  it('passes a prompt string to invokeLlm', async () => {
    mockedInvokeLlm.mockResolvedValue('Answer.');

    await generatorNode(baseState as AgentState);

    expect(mockedInvokeLlm).toHaveBeenCalledWith(expect.any(String));
  });

  it('works correctly when objective is undefined', async () => {
    const stateWithoutObjective: Partial<AgentState> = {
      ...baseState,
      objective: undefined,
    };

    mockedInvokeLlm.mockResolvedValue('Answer without objective.');

    const result = await generatorNode(stateWithoutObjective as AgentState);

    expect(result.phase).toBe('complete');
    expect(result.finalAnswer).toBe('Answer without objective.');
  });

  it('handles LLM returning a very long answer', async () => {
    const longAnswer = 'A'.repeat(10000);
    mockedInvokeLlm.mockResolvedValue(longAnswer);

    const result = await generatorNode(baseState as AgentState);

    expect(result.phase).toBe('complete');
    expect(result.finalAnswer).toBe(longAnswer);
  });
});
