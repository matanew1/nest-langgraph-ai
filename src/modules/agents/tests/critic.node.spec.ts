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
  toolResult: 'some result',
  attempts: [],
};

describe('criticNode', () => {
  afterEach(() => jest.clearAllMocks());

  it('advances to next_step when there are more steps', async () => {
    mockedInvokeLlm.mockResolvedValue(
      '{"status":"next_step","reason":"step succeeded"}',
    );

    const result = await criticNode(baseState as AgentState);

    expect(result.status).toBe('running');
    expect(result.currentStep).toBe(1);
    expect(result.selectedTool).toBe('read_file');
    expect(result.done).toBeUndefined();
  });

  it('completes when next_step is issued on the last step', async () => {
    mockedInvokeLlm.mockResolvedValue('{"status":"next_step","reason":"done"}');

    const lastStepState = { ...baseState, currentStep: 1 } as AgentState;
    const result = await criticNode(lastStepState);

    expect(result.status).toBe('complete');
    expect(result.done).toBe(true);
  });

  it('returns done=true and finalAnswer on complete', async () => {
    mockedInvokeLlm.mockResolvedValue(
      '{"status":"complete","summary":"task accomplished"}',
    );

    const result = await criticNode(baseState as AgentState);

    expect(result.status).toBe('complete');
    expect(result.done).toBe(true);
    expect(result.finalAnswer).toBe('task accomplished');
  });

  it('returns retry on retry status', async () => {
    mockedInvokeLlm.mockResolvedValue(
      '{"status":"retry","reason":"bad result","suggested_fix":"try again"}',
    );

    const result = await criticNode(baseState as AgentState);

    expect(result.status).toBe('retry');
    expect(result.done).toBe(false);
    expect(result.executionPlan).toBe('try again');
  });

  it('returns done=true on error status', async () => {
    mockedInvokeLlm.mockResolvedValue(
      '{"status":"error","message":"impossible task"}',
    );

    const result = await criticNode(baseState as AgentState);

    expect(result.status).toBe('error');
    expect(result.done).toBe(true);
    expect(result.finalAnswer).toBe('impossible task');
  });

  it('heuristic retry when tool result starts with ERROR', async () => {
    mockedInvokeLlm.mockResolvedValue('{"status":"unknown_status"}');

    const errorState = {
      ...baseState,
      toolResult: 'ERROR something went wrong',
    } as AgentState;
    const result = await criticNode(errorState);

    expect(result.status).toBe('retry');
    expect(result.done).toBe(false);
  });

  it('retries on JSON parse failure', async () => {
    mockedInvokeLlm.mockResolvedValue('not json');

    const result = await criticNode(baseState as AgentState);

    expect(result.status).toBe('retry');
    expect(result.done).toBe(false);
  });
});
