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
  input: 'build a typescript script that processes user data files',
  attempts: [],
};

describe('supervisorNode', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns plan_required when LLM approves', async () => {
    mockedInvokeLlm.mockResolvedValue(
      '{"status":"ok","mode":"agent","objective":"do the test task"}',
    );

    const result = await supervisorNode(baseState as AgentState);

    expect(result.phase).toBe('research');
    expect(result.objective).toBe('do the test task');
  });

  it('routes rejected tasks to clarification with a structured error', async () => {
    mockedInvokeLlm.mockResolvedValue(
      '{"status":"reject","mode":"agent","message":"Cannot do this","missing_capabilities":["x"]}',
    );

    const result = await supervisorNode(baseState as AgentState);

    expect(result.phase).toBe('clarification');
    expect(result.finalAnswer).toBeUndefined();
    expect(result.errors?.[0]?.message).toBe('Cannot do this');
  });

  it('transitions to fatal phase when both parse attempts fail (double-parse-failure)', async () => {
    // First call: initial LLM response (invalid JSON)
    // Second call: repair LLM call (also invalid JSON) → safeNodeHandler wraps → fatal
    mockedInvokeLlm
      .mockResolvedValueOnce('not valid json at all')
      .mockResolvedValueOnce('still not valid json');

    await expect(supervisorNode(baseState as AgentState)).rejects.toThrow();
  });
});
