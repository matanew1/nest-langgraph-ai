import { AGENT_PHASES } from './agent-phase';
import { createInitialAgentRunState } from './agent-run-state.util';

describe('agent-run-state.util', () => {
  it('creates a clean run state for a new prompt', () => {
    expect(createInitialAgentRunState('fix the bug')).toEqual({
      input: 'fix the bug',
      phase: AGENT_PHASES.SUPERVISOR,
      currentStep: 0,
      plan: [],
      objective: undefined,
      expectedResult: undefined,
      selectedTool: undefined,
      toolParams: undefined,
      toolResultRaw: undefined,
      toolResult: undefined,
      criticDecision: undefined,
      jsonRepair: undefined,
      jsonRepairResult: undefined,
      finalAnswer: undefined,
      projectContext: undefined,
      memoryContext: undefined,
      sessionMemory: undefined,
      attempts: [],
      counters: {
        turn: 0,
        toolCalls: 0,
        replans: 0,
        stepRetries: 0,
        supervisorFallbacks: 0,
      },
      errors: [],
    });
  });

  it('loads explicit session memory but resets prior run state', () => {
    expect(
      createInitialAgentRunState('new prompt', {
        sessionMemory: 'Earlier decision: keep Redis optional at boot.',
      }),
    ).toMatchObject({
      input: 'new prompt',
      phase: AGENT_PHASES.SUPERVISOR,
      projectContext: undefined,
      memoryContext: undefined,
      sessionMemory: 'Earlier decision: keep Redis optional at boot.',
      attempts: [],
      finalAnswer: undefined,
      plan: [],
      counters: {
        turn: 0,
        toolCalls: 0,
        replans: 0,
        stepRetries: 0,
        supervisorFallbacks: 0,
      },
    });
  });
});
