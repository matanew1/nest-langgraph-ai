import { executionNode } from '../nodes/execution.node';
import { AgentState, PlanStep } from '../state/agent.state';

jest.mock('@config/env', () => ({
  env: {
    toolTimeoutMs: 5000,
    agentWorkingDir: '/tmp',
  },
}));

// Mock the tool registry
const mockInvoke = jest.fn();
jest.mock('../tools/index', () => ({
  toolRegistry: {
    get: jest.fn(),
    getNames: jest.fn().mockReturnValue(['search', 'read_file']),
  },
}));

const { toolRegistry } = require('../tools/index');

const plan: PlanStep[] = [
  {
    step_id: 1,
    description: 'search step',
    tool: 'search',
    input: { query: 'test' },
  },
];

const baseState: Partial<AgentState> = {
  input: 'find something',
  plan,
  currentStep: 0,
  selectedTool: 'search',
  toolParams: { query: 'test' },
  toolInput: '{"query":"test"}',
  attempts: [],
};

describe('executionNode', () => {
  afterEach(() => jest.clearAllMocks());

  it('invokes the tool and returns toolResult on success', async () => {
    toolRegistry.get.mockReturnValue({ invoke: mockInvoke });
    mockInvoke.mockResolvedValue('search results here');

    const result = await executionNode(baseState as AgentState);

    expect(result.toolResult).toBe('search results here');
    expect(result.lastToolErrored).toBe(false);
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts![0].error).toBe(false);
  });

  it('returns error state when tool is not found', async () => {
    toolRegistry.get.mockReturnValue(undefined);

    const result = await executionNode(baseState as AgentState);

    expect(result.lastToolErrored).toBe(true);
    expect(result.toolResult).toContain('Unknown tool');
    expect(result.attempts![0].error).toBe(true);
  });

  it('returns error state when tool throws', async () => {
    toolRegistry.get.mockReturnValue({ invoke: mockInvoke });
    mockInvoke.mockRejectedValue(new Error('tool exploded'));

    const result = await executionNode(baseState as AgentState);

    expect(result.lastToolErrored).toBe(true);
    expect(result.toolResult).toContain('tool exploded');
    expect(result.attempts![0].error).toBe(true);
  });

  it('substitutes __PREVIOUS_RESULT__ in toolParams', async () => {
    toolRegistry.get.mockReturnValue({ invoke: mockInvoke });
    mockInvoke.mockResolvedValue('summarized');

    const stateWithPrev = {
      ...baseState,
      toolParams: { content: '__PREVIOUS_RESULT__', instruction: 'summarize' },
      toolResult: 'raw previous output',
    } as AgentState;

    await executionNode(stateWithPrev);

    const invokedParams = mockInvoke.mock.calls[0][0];
    expect(invokedParams.content).toBe('raw previous output');
  });

  it('substitutes __PREVIOUS_RESULT__ when embedded in a longer string', async () => {
    toolRegistry.get.mockReturnValue({ invoke: mockInvoke });
    mockInvoke.mockResolvedValue('done');

    const stateWithPrev = {
      ...baseState,
      toolParams: { content: 'Analyze this: __PREVIOUS_RESULT__' },
      toolResult: 'the data',
    } as AgentState;

    await executionNode(stateWithPrev);

    const invokedParams = mockInvoke.mock.calls[0][0];
    expect(invokedParams.content).toBe('Analyze this: the data');
  });
});
