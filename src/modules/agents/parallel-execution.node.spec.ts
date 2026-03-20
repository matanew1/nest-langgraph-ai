import { parallelExecutionNode } from '../nodes/parallel-execution.node';
import { AgentState, PlanStep } from '../state/agent.state';

jest.mock('@config/env', () => ({
  env: {
    toolTimeoutMs: 5000,
    agentWorkingDir: '/tmp',
  },
}));

jest.mock('@utils/pretty-log.util', () => ({
  logPhaseStart: jest.fn(),
  logPhaseEnd: jest.fn(),
  startTimer: jest.fn(() => () => 0),
  prettyJson: jest.fn((v) => JSON.stringify(v)),
  preview: jest.fn((s) => String(s).slice(0, 100)),
}));

const mockInvoke = jest.fn();
jest.mock('../tools/index', () => ({
  toolRegistry: {
    get: jest.fn(() => ({ invoke: mockInvoke })),
    getNames: jest.fn(() => ['read_file', 'grep_search']),
  },
}));

jest.mock('../state/agent-state.helpers', () => ({
  incrementAgentCounters: jest.fn((c, inc) => ({
    ...c,
    toolCalls: (c.toolCalls ?? 0) + (inc.toolCalls ?? 0),
  })),
  getAgentCounters: jest.fn((c) => c),
}));

const makeStep = (id: number, tool: string, group: number): PlanStep => ({
  step_id: id,
  description: `Step ${id}`,
  tool,
  input: { path: `file${id}.ts` },
  parallel_group: group,
});

const baseState: Partial<AgentState> = {
  plan: [makeStep(1, 'read_file', 1), makeStep(2, 'read_file', 1), makeStep(3, 'grep_search', 2)],
  currentStep: 0,
  counters: { turn: 0, toolCalls: 0, replans: 0, stepRetries: 0, supervisorFallbacks: 0 },
  errors: [],
  attempts: [],
  phase: 'execute_parallel' as any,
};

describe('parallelExecutionNode', () => {
  afterEach(() => jest.clearAllMocks());

  it('executes all steps in the current parallel group concurrently', async () => {
    mockInvoke
      .mockResolvedValueOnce('result1')
      .mockResolvedValueOnce('result2');

    const result = await parallelExecutionNode(baseState as AgentState);

    expect(mockInvoke).toHaveBeenCalledTimes(2);
    expect(result.parallelResult).toBe(true);
    expect(result.phase).toBe('normalize_tool_result');
    const parsed = JSON.parse(result.toolResultRaw!);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].status).toBe('fulfilled');
  });

  it('handles partial failures gracefully', async () => {
    mockInvoke
      .mockResolvedValueOnce('ok-result')
      .mockRejectedValueOnce(new Error('tool failed'));

    const result = await parallelExecutionNode(baseState as AgentState);

    const parsed = JSON.parse(result.toolResultRaw!);
    expect(parsed[0].status).toBe('fulfilled');
    expect(parsed[1].status).toBe('rejected');
    expect(result.errors).toBeDefined();
  });
});