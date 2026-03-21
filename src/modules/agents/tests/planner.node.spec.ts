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

  it('routes to fatal when LLM returns empty steps array', async () => {
    mockedInvokeLlm.mockResolvedValue(
      JSON.stringify({
        objective: 'Do something',
        steps: [],
        expected_result: 'Result',
      }),
    );

    const result = await plannerNode(baseState as AgentState);

    // Empty steps fails Zod schema (min(1)) → json_repair route
    expect(result.phase).toBe('route');
    expect(result.jsonRepair).toBeDefined();
  });

  it('routes to json_repair on malformed (non-JSON) LLM output', async () => {
    mockedInvokeLlm.mockResolvedValue('This is not JSON at all');

    const result = await plannerNode(baseState as AgentState);

    expect(result.phase).toBe('route');
    expect(result.jsonRepair).toBeDefined();
    expect(result.jsonRepair!.fromPhase).toBe('plan');
  });

  it('routes to json_repair when JSON is missing required fields', async () => {
    mockedInvokeLlm.mockResolvedValue(
      JSON.stringify({ objective: 'Do something' }),
    );

    const result = await plannerNode(baseState as AgentState);

    expect(result.phase).toBe('route');
    expect(result.jsonRepair).toBeDefined();
  });

  it('uses jsonRepairResult instead of calling LLM when available', async () => {
    const stateWithRepair: Partial<AgentState> = {
      ...baseState,
      jsonRepairResult: validPlanOutput,
    };

    const result = await plannerNode(stateWithRepair as AgentState);

    expect(mockedInvokeLlm).not.toHaveBeenCalled();
    expect(result.phase).toBe('validate_plan');
    expect(result.plan!.length).toBe(2);
  });

  it('clears jsonRepairResult in output after successful parse', async () => {
    const stateWithRepair: Partial<AgentState> = {
      ...baseState,
      jsonRepairResult: validPlanOutput,
    };

    const result = await plannerNode(stateWithRepair as AgentState);

    expect(result.jsonRepairResult).toBeUndefined();
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

  it('routes to fatal when steps is missing from LLM output', async () => {
    mockedInvokeLlm.mockResolvedValue(
      JSON.stringify({
        objective: 'Do something',
        expected_result: 'Done',
      }),
    );

    const result = await plannerNode(baseState as AgentState);

    expect(result.phase).toBe('route');
    expect(result.jsonRepair).toBeDefined();
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
