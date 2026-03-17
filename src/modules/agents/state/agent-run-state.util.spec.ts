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

  it('preserves reusable context from the previous session state', () => {
    expect(
      createInitialAgentRunState('new prompt', {
        projectContext: 'cached tree',
        attempts: [
          {
            tool: 'read_file',
            step: 1,
            params: { path: 'README.md' },
            result: {
              ok: true,
              kind: 'text',
              raw: 'hello',
              preview: 'hello',
              meta: { truncated: false, length: 5 },
            },
          },
        ],
        finalAnswer: 'old answer',
      } as any),
    ).toMatchObject({
      input: 'new prompt',
      phase: AGENT_PHASES.SUPERVISOR,
      projectContext: 'cached tree',
      attempts: [
        {
          tool: 'read_file',
          step: 1,
        },
      ],
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
