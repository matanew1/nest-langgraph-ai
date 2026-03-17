import { executionNode } from '../nodes/execution.node';
import { AgentState, PlanStep } from '../state/agent.state';
import { toolRegistry } from '../tools/index';

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
  attempts: [],
};

describe('executionNode', () => {
  afterEach(() => jest.clearAllMocks());

  it('invokes the tool and returns toolResult on success', async () => {
    toolRegistry.get.mockReturnValue({ invoke: mockInvoke });
    mockInvoke.mockResolvedValue('search results here');

    const result = await executionNode(baseState as AgentState);

    expect(result.phase).toBe('normalize_tool_result');
    expect(result.toolResultRaw).toBe('search results here');
  });

  it('returns error state when tool is not found', async () => {
    toolRegistry.get.mockReturnValue(undefined);

    const result = await executionNode(baseState as AgentState);

    expect(result.phase).toBe('normalize_tool_result');
    expect(result.toolResultRaw).toContain('ERROR');
  });

  it('returns error state when tool throws', async () => {
    toolRegistry.get.mockReturnValue({ invoke: mockInvoke });
    mockInvoke.mockRejectedValue(new Error('tool exploded'));

    const result = await executionNode(baseState as AgentState);

    expect(result.phase).toBe('normalize_tool_result');
    expect(result.toolResultRaw).toContain('ERROR');
  });

  it('substitutes __PREVIOUS_RESULT__ in toolParams', async () => {
    toolRegistry.get.mockReturnValue({ invoke: mockInvoke });
    mockInvoke.mockResolvedValue('summarized');

    const stateWithPrev = {
      ...baseState,
      toolParams: { content: '__PREVIOUS_RESULT__', instruction: 'summarize' },
      toolResultRaw: 'raw previous output',
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
      toolResultRaw: 'the data',
    } as AgentState;

    await executionNode(stateWithPrev);

    const invokedParams = mockInvoke.mock.calls[0][0];
    expect(invokedParams.content).toBe('Analyze this: the data');
  });
});
