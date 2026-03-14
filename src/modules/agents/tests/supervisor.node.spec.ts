import { supervisorNode } from '../nodes/supervisor.node';
import { AgentState } from '../state/agent.state';

jest.mock('@config/env', () => ({
  env: {
    groqTimeoutMs: 5000,
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

const { invokeLlm } = require('@llm/llm.provider');

const baseState: Partial<AgentState> = {
  input: 'test task',
  iteration: 0,
  attempts: [],
};

describe('supervisorNode', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns plan_required when LLM approves', async () => {
    invokeLlm.mockResolvedValue('{"status":"plan_required","task":"do the test task"}');

    const result = await supervisorNode(baseState as AgentState);

    expect(result.status).toBe('plan_required');
    expect(result.executionPlan).toBe('do the test task');
    expect(result.iteration).toBe(1);
    expect(result.done).toBeUndefined();
  });

  it('returns error and done=true when LLM rejects task', async () => {
    invokeLlm.mockResolvedValue('{"status":"error","message":"Cannot do this"}');

    const result = await supervisorNode(baseState as AgentState);

    expect(result.status).toBe('error');
    expect(result.done).toBe(true);
    expect(result.finalAnswer).toBe('Cannot do this');
  });

  it('falls back to forwarding raw input on JSON parse failure', async () => {
    invokeLlm.mockResolvedValue('not valid json at all');

    const result = await supervisorNode(baseState as AgentState);

    expect(result.status).toBe('plan_required');
    expect(result.executionPlan).toBe('test task');
  });

  it('increments iteration correctly', async () => {
    invokeLlm.mockResolvedValue('{"status":"plan_required","task":"task"}');

    const result = await supervisorNode({ ...baseState, iteration: 2 } as AgentState);

    expect(result.iteration).toBe(3);
  });
});
