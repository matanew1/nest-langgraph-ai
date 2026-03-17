import { supervisorNode } from '../nodes/supervisor.node';
import { AgentState } from '../state/agent.state';
import { invokeLlm } from '@llm/llm.provider';

jest.mock('@config/env', () => ({
  env: {
    mistralTimeoutMs: 5000,
    promptMaxAttempts: 5,
    agentWorkingDir: '/tmp',
  },
}));

jest.mock('@llm/llm.provider', () => ({
  invokeLlm: jest.fn(),
}));

jest.mock('../prompts/agent.prompts', () => ({
  buildSupervisorPrompt: jest.fn().mockReturnValue('mock prompt'),
}));
const mockedInvokeLlm = jest.mocked(invokeLlm);

const baseState: Partial<AgentState> = {
  input: 'test task',
  attempts: [],
};

describe('supervisorNode', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns plan_required when LLM approves', async () => {
    mockedInvokeLlm.mockResolvedValue(
      '{"status":"ok","objective":"do the test task"}',
    );

    const result = await supervisorNode(baseState as AgentState);

    expect(result.phase).toBe('research');
    expect(result.objective).toBe('do the test task');
  });

  it('routes rejected tasks to clarification with a structured error', async () => {
    mockedInvokeLlm.mockResolvedValue(
      '{"status":"reject","message":"Cannot do this","missing_capabilities":["x"]}',
    );

    const result = await supervisorNode(baseState as AgentState);

    expect(result.phase).toBe('clarification');
    expect(result.finalAnswer).toBeUndefined();
    expect(result.errors?.[0]?.message).toBe('Cannot do this');
  });

  it('routes to json repair on JSON parse failure', async () => {
    mockedInvokeLlm.mockResolvedValue('not valid json at all');

    const result = await supervisorNode(baseState as AgentState);

    expect(result.jsonRepair).toBeDefined();
    expect(result.phase).toBe('route');
  });
});
