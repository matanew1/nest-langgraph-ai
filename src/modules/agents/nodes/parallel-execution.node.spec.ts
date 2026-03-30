import { parallelExecutionNode } from './parallel-execution.node';
import type { AgentState, PlanStep } from '../state/agent.state';

jest.mock('../tools/index', () => ({
  toolRegistry: {
    get: jest.fn(),
    getNames: jest.fn().mockReturnValue(['tool_a', 'tool_b']),
  },
}));

jest.mock('@config/env', () => ({
  env: { toolTimeoutMs: 5000 },
}));

jest.mock('../state/agent-transition.util', () => ({
  transitionToPhase: jest
    .fn()
    .mockImplementation((phase, patch) => ({ phase, ...patch })),
}));

jest.mock('../graph/agent.config', () => ({
  AGENT_CONSTANTS: { maxParallelTools: 5 },
  getAgentLimits: jest.fn(),
}));

jest.mock('../state/agent-state.helpers', () => ({
  incrementAgentCounters: jest.fn().mockImplementation((c, d) => ({
    ...c,
    toolCalls: (c?.toolCalls ?? 0) + (d?.toolCalls ?? 0),
  })),
}));

jest.mock('@utils/pretty-log.util', () => ({
  logPhaseStart: jest.fn(),
  logPhaseEnd: jest.fn(),
  startTimer: jest.fn().mockReturnValue(() => 0),
}));

const { toolRegistry } = require('../tools/index') as {
  toolRegistry: {
    get: jest.Mock;
    getNames: jest.Mock;
  };
};

function makeState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    input: 'test',
    plan: [],
    currentStep: 0,
    counters: {
      turn: 0,
      toolCalls: 0,
      replans: 0,
      stepRetries: 0,
      supervisorFallbacks: 0,
    },
    errors: [],
    ...overrides,
  } as AgentState;
}

function makeStep(
  step_id: number,
  tool: string,
  parallel_group: number,
  input: Record<string, unknown> = {},
): PlanStep {
  return {
    step_id,
    description: `step ${step_id}`,
    tool,
    input,
    parallel_group,
  };
}

function makeTool(invokeFn: jest.Mock) {
  return { invoke: invokeFn };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('parallelExecutionNode', () => {
  it('executes all steps in the parallel group and returns JSON results', async () => {
    const plan = [makeStep(1, 'tool_a', 1), makeStep(2, 'tool_b', 1)];
    const invokeA = jest.fn().mockResolvedValue('result_a');
    const invokeB = jest.fn().mockResolvedValue('result_b');

    toolRegistry.get.mockImplementation((name: string) => {
      if (name === 'tool_a') return makeTool(invokeA);
      if (name === 'tool_b') return makeTool(invokeB);
      return undefined;
    });

    const state = makeState({ plan, currentStep: 0 });
    const output = await parallelExecutionNode(state);

    expect(output.parallelResult).toBe(true);
    const parsed = JSON.parse(output.toolResultRaw as string);
    expect(parsed).toHaveLength(2);

    const stepA = parsed.find((r: any) => r.step_id === 1);
    const stepB = parsed.find((r: any) => r.step_id === 2);

    expect(stepA).toMatchObject({
      step_id: 1,
      tool: 'tool_a',
      result: 'result_a',
      success: true,
    });
    expect(stepB).toMatchObject({
      step_id: 2,
      tool: 'tool_b',
      result: 'result_b',
      success: true,
    });
  });

  it('handles partial failure: failed steps are errors, successful steps still included', async () => {
    const plan = [makeStep(1, 'tool_a', 1), makeStep(2, 'tool_b', 1)];
    const invokeA = jest.fn().mockResolvedValue('result_a');
    const invokeB = jest.fn().mockRejectedValue(new Error('network error'));

    toolRegistry.get.mockImplementation((name: string) => {
      if (name === 'tool_a') return makeTool(invokeA);
      if (name === 'tool_b') return makeTool(invokeB);
      return undefined;
    });

    const state = makeState({ plan, currentStep: 0 });
    const output = await parallelExecutionNode(state);

    const parsed = JSON.parse(output.toolResultRaw as string);
    expect(parsed).toHaveLength(2);

    const stepA = parsed.find((r: any) => r.step_id === 1);
    const stepB = parsed.find((r: any) => r.step_id === 2);

    expect(stepA).toMatchObject({ success: true, result: 'result_a' });
    expect(stepB).toMatchObject({ success: false });
    expect(stepB.result).toContain('network error');

    expect(output.errors).toHaveLength(1);
    expect((output.errors as any[])[0].code).toBe('tool_error');
  });

  it('handles unknown tool: returns success=false and error message in result', async () => {
    const plan = [makeStep(1, 'tool_a', 1), makeStep(2, 'unknown_tool', 1)];
    const invokeA = jest.fn().mockResolvedValue('result_a');

    toolRegistry.get.mockImplementation((name: string) => {
      if (name === 'tool_a') return makeTool(invokeA);
      return undefined; // unknown_tool not found
    });

    const state = makeState({ plan, currentStep: 0 });
    const output = await parallelExecutionNode(state);

    const parsed = JSON.parse(output.toolResultRaw as string);
    const unknownStep = parsed.find((r: any) => r.tool === 'unknown_tool');

    expect(unknownStep.success).toBe(false);
    expect(unknownStep.result).toContain('Unknown tool');
    expect(unknownStep.result).toContain('unknown_tool');
  });

  it('only collects contiguous steps with the same parallel_group', async () => {
    const plan = [
      makeStep(1, 'tool_a', 1),
      makeStep(2, 'tool_b', 1),
      makeStep(3, 'tool_a', 2), // different group — must not be executed
    ];
    const invokeA = jest.fn().mockResolvedValue('result_a');
    const invokeB = jest.fn().mockResolvedValue('result_b');

    toolRegistry.get.mockImplementation((name: string) => {
      if (name === 'tool_a') return makeTool(invokeA);
      if (name === 'tool_b') return makeTool(invokeB);
      return undefined;
    });

    const state = makeState({ plan, currentStep: 0 });
    const output = await parallelExecutionNode(state);

    const parsed = JSON.parse(output.toolResultRaw as string);
    expect(parsed).toHaveLength(2);
    expect(parsed.find((r: any) => r.step_id === 3)).toBeUndefined();
    // tool_a is called once (for step 1), NOT for step 3
    expect(invokeA).toHaveBeenCalledTimes(1);
  });

  it('caps at maxParallelTools (5) even if more steps share the same group', async () => {
    // 7 steps all in group 1
    const plan = Array.from({ length: 7 }, (_, i) =>
      makeStep(i + 1, 'tool_a', 1),
    );
    const invokeA = jest.fn().mockResolvedValue('ok');

    toolRegistry.get.mockImplementation(() => makeTool(invokeA));

    const state = makeState({ plan, currentStep: 0 });
    const output = await parallelExecutionNode(state);

    const parsed = JSON.parse(output.toolResultRaw as string);
    expect(parsed).toHaveLength(5); // capped at maxParallelTools
    expect(invokeA).toHaveBeenCalledTimes(5);
  });

  it('resolves __INLINE_CONTENT__ for parallel steps from the user message', async () => {
    const plan = [
      makeStep(1, 'tool_a', 1, { content: '__INLINE_CONTENT__' }),
      makeStep(2, 'tool_b', 1, { content: '__INLINE_CONTENT__' }),
    ];
    const invokeA = jest.fn().mockResolvedValue('analysis_a');
    const invokeB = jest.fn().mockResolvedValue('analysis_b');

    toolRegistry.get.mockImplementation((name: string) => {
      if (name === 'tool_a') return makeTool(invokeA);
      if (name === 'tool_b') return makeTool(invokeB);
      return undefined;
    });

    const state = makeState({
      input: '[Attached: app.ts]\n```ts\nconst value = 42;\n```',
      plan,
      currentStep: 0,
    });

    await parallelExecutionNode(state);

    expect(invokeA).toHaveBeenCalledWith(
      { content: 'const value = 42;' },
      expect.anything(),
    );
    expect(invokeB).toHaveBeenCalledWith(
      { content: 'const value = 42;' },
      expect.anything(),
    );
  });

  it('marks a parallel step as failed when __INLINE_CONTENT__ cannot be resolved', async () => {
    const plan = [makeStep(1, 'tool_a', 1, { content: '__INLINE_CONTENT__' })];
    const invokeA = jest.fn().mockResolvedValue('analysis_a');

    toolRegistry.get.mockImplementation(() => makeTool(invokeA));

    const state = makeState({
      input: 'No inline attachment here',
      plan,
      currentStep: 0,
    });

    const output = await parallelExecutionNode(state);
    const parsed = JSON.parse(output.toolResultRaw as string);

    expect(parsed[0]).toMatchObject({
      step_id: 1,
      tool: 'tool_a',
      success: false,
    });
    expect(parsed[0].result).toContain('__INLINE_CONTENT__ could not be resolved');
    expect(invokeA).not.toHaveBeenCalled();
  });
});
