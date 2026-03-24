import { criticNode } from '../nodes/critic.node';
import { AgentState, PlanStep } from '../state/agent.state';
import { invokeLlm } from '@llm/llm.provider';

jest.mock('@config/env', () => ({
  env: {
    mistralTimeoutMs: 5000,
    promptMaxAttempts: 5,
  },
}));

jest.mock('@llm/llm.provider', () => ({
  invokeLlm: jest.fn(),
}));

jest.mock('../prompts/agent.prompts', () => ({
  buildCriticPrompt: jest.fn().mockReturnValue('mock prompt'),
}));
const mockedInvokeLlm = jest.mocked(invokeLlm);

const plan: PlanStep[] = [
  {
    step_id: 1,
    description: 'step one',
    tool: 'search',
    input: { query: 'test' },
  },
  {
    step_id: 2,
    description: 'step two',
    tool: 'read_file',
    input: { path: 'file.txt' },
  },
];

const baseState: Partial<AgentState> = {
  input: 'find something',
  plan,
  currentStep: 0,
  selectedTool: 'search',
  toolResult: {
    ok: true,
    kind: 'text',
    summary: 'ok',
    preview: 'some result',
    raw: 'some result',
  },
  attempts: [],
};

describe('criticNode', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns a routed advance decision', async () => {
    mockedInvokeLlm.mockResolvedValue(
      '{"decision":"advance","reason":"step succeeded"}',
    );

    const result = await criticNode(baseState as AgentState);

    expect(result.phase).toBe('route');
    expect(result.criticDecision?.decision).toBe('advance');
  });

  it('returns a complete decision with finalAnswer', async () => {
    mockedInvokeLlm.mockResolvedValue(
      '{"decision":"complete","reason":"task accomplished","finalAnswer":"task accomplished"}',
    );

    const result = await criticNode(baseState as AgentState);

    expect(result.phase).toBe('route');
    expect(result.criticDecision?.decision).toBe('complete');
    expect(result.criticDecision?.finalAnswer).toBe('task accomplished');
  });

  it('returns a retry_step decision', async () => {
    mockedInvokeLlm.mockResolvedValue(
      '{"decision":"retry_step","reason":"bad result"}',
    );

    const result = await criticNode(baseState as AgentState);

    expect(result.phase).toBe('route');
    expect(result.criticDecision?.decision).toBe('retry_step');
  });

  it('returns a fatal decision', async () => {
    mockedInvokeLlm.mockResolvedValue(
      '{"decision":"fatal","reason":"impossible","finalAnswer":"impossible task"}',
    );

    const result = await criticNode(baseState as AgentState);

    expect(result.phase).toBe('route');
    expect(result.criticDecision?.decision).toBe('fatal');
  });

  it('throws on double-parse-failure when JSON is invalid', async () => {
    mockedInvokeLlm
      .mockResolvedValueOnce('not json')
      .mockResolvedValueOnce('still not json');

    await expect(criticNode(baseState as AgentState)).rejects.toThrow();
  });
});
