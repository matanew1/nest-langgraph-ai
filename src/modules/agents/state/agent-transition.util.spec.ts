import { AGENT_PHASES } from './agent-phase';
import {
  beginExecutionStep,
  completeAgentRun,
  failAgentRun,
  replayRepairedJson,
  requestJsonRepair,
  transitionToPhase,
} from './agent-transition.util';

describe('agent-transition.util', () => {
  it('transitions to an arbitrary phase with extra state updates', () => {
    expect(
      transitionToPhase(AGENT_PHASES.RESEARCH, { objective: 'inspect repo' }),
    ).toEqual({
      phase: AGENT_PHASES.RESEARCH,
      objective: 'inspect repo',
    });
  });

  it('builds an execution transition from a plan step', () => {
    expect(
      beginExecutionStep(
        {
          step_id: 2,
          description: 'read the file',
          tool: 'read_file',
          input: { path: 'src/main.ts' },
        },
        1,
        { criticDecision: undefined },
      ),
    ).toEqual({
      phase: AGENT_PHASES.EXECUTE,
      currentStep: 1,
      selectedTool: 'read_file',
      toolParams: { path: 'src/main.ts' },
      criticDecision: undefined,
    });
  });

  it('builds fatal and complete terminal states', () => {
    expect(completeAgentRun('done')).toEqual({
      phase: AGENT_PHASES.COMPLETE,
      finalAnswer: 'done',
    });

    expect(
      failAgentRun('failed', {
        code: 'timeout',
        message: 'Exceeded max turns',
        atPhase: AGENT_PHASES.ROUTE,
      }),
    ).toEqual({
      phase: AGENT_PHASES.FATAL,
      finalAnswer: 'failed',
      errors: [
        {
          code: 'timeout',
          message: 'Exceeded max turns',
          atPhase: AGENT_PHASES.ROUTE,
        },
      ],
    });
  });

  it('builds JSON repair and replay transitions', () => {
    expect(
      requestJsonRepair({
        fromPhase: AGENT_PHASES.SUPERVISOR,
        raw: 'oops',
        schema: '{"status":"ok"}',
        message: 'Invalid JSON',
      }),
    ).toEqual({
      phase: AGENT_PHASES.ROUTE,
      jsonRepair: {
        fromPhase: AGENT_PHASES.SUPERVISOR,
        raw: 'oops',
        schema: '{"status":"ok"}',
      },
      errors: [
        {
          code: 'json_invalid',
          message: 'Invalid JSON',
          atPhase: AGENT_PHASES.SUPERVISOR,
        },
      ],
    });

    expect(
      replayRepairedJson(AGENT_PHASES.PLAN, '{"objective":"x"}', {
        jsonRepair: undefined,
      }),
    ).toEqual({
      phase: AGENT_PHASES.PLAN,
      jsonRepair: undefined,
      jsonRepairResult: '{"objective":"x"}',
      jsonRepairFromPhase: undefined,
    });
  });
});
