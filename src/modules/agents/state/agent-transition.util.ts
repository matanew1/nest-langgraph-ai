import { AGENT_PHASES, type AgentPhase } from './agent-phase';
import type { AgentError, AgentState, PlanStep } from './agent.state';

type AgentStateUpdates = Omit<Partial<AgentState>, 'phase'>;

export function transitionToPhase(
  phase: AgentPhase,
  updates: AgentStateUpdates = {},
): Partial<AgentState> {
  return {
    ...updates,
    phase,
  };
}

export function beginExecutionStep(
  step: PlanStep,
  stepIndex: number,
  updates: AgentStateUpdates = {},
): Partial<AgentState> {
  return transitionToPhase(AGENT_PHASES.EXECUTE, {
    ...updates,
    currentStep: stepIndex,
    selectedTool: step.tool,
    toolParams: step.input,
  });
}

export function completeAgentRun(
  finalAnswer: string,
  updates: AgentStateUpdates = {},
): Partial<AgentState> {
  return transitionToPhase(AGENT_PHASES.COMPLETE, {
    ...updates,
    finalAnswer,
  });
}

export function failAgentRun(
  finalAnswer: string,
  error?: AgentError,
  updates: AgentStateUpdates = {},
): Partial<AgentState> {
  return transitionToPhase(AGENT_PHASES.FATAL, {
    ...updates,
    finalAnswer,
    ...(error ? { errors: [error] } : {}),
  });
}

export function requestClarification(
  error: AgentError,
  updates: AgentStateUpdates = {},
): Partial<AgentState> {
  return transitionToPhase(AGENT_PHASES.CLARIFICATION, {
    ...updates,
    errors: [error],
  });
}

export function requestJsonRepair(args: {
  fromPhase: AgentPhase;
  raw: string;
  schema: string;
  message: string;
}): Partial<AgentState> {
  return transitionToPhase(AGENT_PHASES.ROUTE, {
    jsonRepair: {
      fromPhase: args.fromPhase,
      raw: args.raw,
      schema: args.schema,
    },
    errors: [
      {
        code: 'json_invalid',
        message: args.message,
        atPhase: args.fromPhase,
      },
    ],
  });
}

export function replayRepairedJson(
  phase: AgentPhase,
  jsonRepairResult: string,
  updates: AgentStateUpdates = {},
): Partial<AgentState> {
  return transitionToPhase(phase, {
    ...updates,
    jsonRepairResult,
    jsonRepairFromPhase: undefined,
  });
}
