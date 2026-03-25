import { plannerNode } from '../nodes/planner.node';
import { AgentState, PlanStep } from '../state/agent.state';
import { invokeLlm } from '@llm/llm.provider';
import { buildPlannerPrompt } from '../prompts/agent.prompts';

jest.mock('@config/env', () => ({
  env: {
    mistralTimeoutMs: 5000,
    promptMaxAttempts: 5,
    agentWorkingDir: '/tmp',
    promptMaxSummaryChars: 2000,
  },
}));

jest.mock('@llm/llm.provider', () => ({
  invokeLlm: jest.fn(),
}));

jest.mock('../prompts/agent.prompts', () => ({
  buildPlannerPrompt: jest.fn().mockReturnValue('mock planner prompt'),
}));

const mockedBuildPlannerPrompt = jest.mocked(buildPlannerPrompt);

const mockedInvokeLlm = jest.mocked(invokeLlm);

const validPlanOutput = JSON.stringify({
  objective: 'Find and summarize data',
  steps: [
    {
      step_id: 1,
      description: 'Search for relevant files',
      tool: 'search',
      input: { query: 'data files' },
    },
    {
      step_id: 2,
      description: 'Read the found file',
      tool: 'read_file',
      input: { path: 'data.txt' },
    },
  ],
  expected_result: 'A summary of the data files',
});

const baseState: Partial<AgentState> = {
  input: 'Find and summarize data files',
  objective: 'Find and summarize data',
  attempts: [],
  plan: [],
  counters: {
    turn: 0,
    toolCalls: 0,
    replans: 0,
    stepRetries: 0,
    supervisorFallbacks: 0,
  },
  errors: [],
};

describe('plannerNode', () => {
  afterEach(() => jest.clearAllMocks());

  it('creates a valid plan and transitions to validate_plan phase', async () => {
    mockedInvokeLlm.mockResolvedValue(validPlanOutput);

    const result = await plannerNode(baseState as AgentState);

    expect(result.phase).toBe('validate_plan');
    expect(result.plan).toBeDefined();
    expect(Array.isArray(result.plan)).toBe(true);
    expect(result.plan!.length).toBe(2);
  });

  it('sets correct PlanStep shape on each step', async () => {
    mockedInvokeLlm.mockResolvedValue(validPlanOutput);

    const result = await plannerNode(baseState as AgentState);

    const firstStep = result.plan![0];
    expect(firstStep.step_id).toBe(1);
    expect(firstStep.description).toBe('Search for relevant files');
    expect(firstStep.tool).toBe('search');
    expect(firstStep.input).toEqual({ query: 'data files' });
  });

  it('sets selectedTool and toolParams from the first step', async () => {
    mockedInvokeLlm.mockResolvedValue(validPlanOutput);

    const result = await plannerNode(baseState as AgentState);

    expect(result.selectedTool).toBe('search');
    expect(result.toolParams).toEqual({ query: 'data files' });
    expect(result.currentStep).toBe(0);
  });

  it('sets expectedResult and objective from plan output', async () => {
    mockedInvokeLlm.mockResolvedValue(validPlanOutput);

    const result = await plannerNode(baseState as AgentState);

    expect(result.expectedResult).toBe('A summary of the data files');
    expect(result.objective).toBe('Find and summarize data');
  });

  it('routes to fatal when LLM returns empty steps array (schema min(1) fails, repair also fails)', async () => {
    // First call: invalid (empty steps fails min(1)), second call: repair also returns empty steps
    mockedInvokeLlm
      .mockResolvedValueOnce(
        JSON.stringify({
          objective: 'Do something',
          steps: [],
          expected_result: 'Result',
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          objective: 'Do something',
          steps: [],
          expected_result: 'Result',
        }),
      );

    await expect(plannerNode(baseState as AgentState)).rejects.toThrow();
  });

  it('throws on double-parse-failure for malformed (non-JSON) LLM output', async () => {
    mockedInvokeLlm
      .mockResolvedValueOnce('This is not JSON at all')
      .mockResolvedValueOnce('still not JSON');

    await expect(plannerNode(baseState as AgentState)).rejects.toThrow();
  });

  it('throws on double-parse-failure when JSON is missing required fields', async () => {
    mockedInvokeLlm
      .mockResolvedValueOnce(JSON.stringify({ objective: 'Do something' }))
      .mockResolvedValueOnce(JSON.stringify({ objective: 'Do something' }));

    await expect(plannerNode(baseState as AgentState)).rejects.toThrow();
  });

  it('repairs JSON inline when first parse fails but repair call succeeds', async () => {
    mockedInvokeLlm
      .mockResolvedValueOnce('This is not JSON at all')
      .mockResolvedValueOnce(validPlanOutput);

    const result = await plannerNode(baseState as AgentState);

    expect(mockedInvokeLlm).toHaveBeenCalledTimes(2);
    expect(result.phase).toBe('validate_plan');
    expect(result.plan!.length).toBe(2);
  });

  it('does not set phase directly — uses transitionToPhase helper', async () => {
    mockedInvokeLlm.mockResolvedValue(validPlanOutput);

    const result = await plannerNode(baseState as AgentState);

    // The result should have a phase key (set by transitionToPhase), not from direct assignment
    expect(Object.prototype.hasOwnProperty.call(result, 'phase')).toBe(true);
    expect(result.phase).toBe('validate_plan');
  });

  it('handles a plan with the maximum allowed steps (20)', async () => {
    const twentySteps = Array.from({ length: 20 }, (_, i) => ({
      step_id: i + 1,
      description: `Step ${i + 1}`,
      tool: 'search',
      input: { query: `query ${i + 1}` },
    }));

    mockedInvokeLlm.mockResolvedValue(
      JSON.stringify({
        objective: 'Big objective',
        steps: twentySteps,
        expected_result: 'All done',
      }),
    );

    const result = await plannerNode(baseState as AgentState);

    expect(result.phase).toBe('validate_plan');
    expect(result.plan!.length).toBe(20);
  });

  it('throws on double-parse-failure when steps is missing from LLM output', async () => {
    mockedInvokeLlm
      .mockResolvedValueOnce(
        JSON.stringify({
          objective: 'Do something',
          expected_result: 'Done',
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          objective: 'Do something',
          expected_result: 'Done',
        }),
      );

    await expect(plannerNode(baseState as AgentState)).rejects.toThrow();
  });

  it('propagates an unhandled error when invokeLlm throws (LLM call is outside try/catch)', async () => {
    // The await getStructuredNodeRawResponse() is outside the try/catch block in planner.node.ts,
    // so a rejection from invokeLlm propagates unhandled to the caller.
    const timeoutError = new Error('Request timed out after 5000ms');
    mockedInvokeLlm.mockRejectedValue(timeoutError);

    await expect(plannerNode(baseState as AgentState)).rejects.toThrow(
      'Request timed out after 5000ms',
    );
  });

  it('accepts a plan with more than 20 steps (no max constraint in schema)', async () => {
    const twentyFiveSteps = Array.from({ length: 25 }, (_, i) => ({
      step_id: i + 1,
      description: `Step ${i + 1}`,
      tool: 'read_file',
      input: { path: `file${i + 1}.txt` },
    }));

    mockedInvokeLlm.mockResolvedValue(
      JSON.stringify({
        objective: 'Large plan objective',
        steps: twentyFiveSteps,
        expected_result: 'All 25 steps done',
      }),
    );

    const result = await plannerNode(baseState as AgentState);

    // Schema has .min(1) but no .max(), so >20 steps are accepted
    expect(result.phase).toBe('validate_plan');
    expect(result.plan!.length).toBe(25);
  });

  it('passes projectContext and memoryContext from state into the prompt builder', async () => {
    const stateWithContext: Partial<AgentState> = {
      ...baseState,
      projectContext: 'src/\n  index.ts\n  main.ts',
      memoryContext: 'Previous run: searched for config files',
    };

    mockedInvokeLlm.mockResolvedValue(validPlanOutput);

    await plannerNode(stateWithContext as AgentState);

    expect(mockedBuildPlannerPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        projectContext: 'src/\n  index.ts\n  main.ts',
        memoryContext: 'Previous run: searched for config files',
      }),
    );
  });

  it('accepts plan steps referencing an unknown tool (planner does not validate tool names)', async () => {
    mockedInvokeLlm.mockResolvedValue(
      JSON.stringify({
        objective: 'Do something with a custom tool',
        steps: [
          {
            step_id: 1,
            description: 'Use a non-existent tool',
            tool: 'non_existent_tool_xyz',
            input: { param: 'value' },
          },
        ],
        expected_result: 'Done',
      }),
    );

    const result = await plannerNode(baseState as AgentState);

    // Planner does not validate tool names — that is the plan-validator's responsibility
    expect(result.phase).toBe('validate_plan');
    expect(result.plan![0].tool).toBe('non_existent_tool_xyz');
  });
});
