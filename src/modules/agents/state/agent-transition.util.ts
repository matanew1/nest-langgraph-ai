import { Logger } from '@nestjs/common';
import { AGENT_PHASES, type AgentPhase } from './agent-phase';
import type {
  AgentError,
  AgentState,
  AgentStateUpdates,
  PlanStep,
  ReviewRequest,
} from './agent.state';

const transitionLogger = new Logger('PhaseTransition');

/**
 * Valid phase transitions. Each key maps to the set of phases it may transition TO.
 * Unlisted transitions are logged as warnings (non-blocking) to aid debugging.
 */
const VALID_TRANSITIONS: Partial<Record<AgentPhase, Set<AgentPhase>>> = {
  [AGENT_PHASES.SUPERVISOR]: new Set([
    AGENT_PHASES.RESEARCH,
    AGENT_PHASES.CHAT,
    AGENT_PHASES.CLARIFICATION,
    AGENT_PHASES.FATAL,
  ]),
  [AGENT_PHASES.RESEARCH]: new Set([
    AGENT_PHASES.RESEARCH_JOIN,
    AGENT_PHASES.FATAL,
  ]),
  [AGENT_PHASES.RESEARCH_JOIN]: new Set([
    AGENT_PHASES.PLAN,
    AGENT_PHASES.FATAL,
  ]),
  [AGENT_PHASES.PLAN]: new Set([
    AGENT_PHASES.VALIDATE_PLAN,
    AGENT_PHASES.FATAL,
  ]),
  [AGENT_PHASES.VALIDATE_PLAN]: new Set([
    AGENT_PHASES.EXECUTE,
    AGENT_PHASES.EXECUTE_PARALLEL,
    AGENT_PHASES.AWAIT_PLAN_REVIEW,
    AGENT_PHASES.FATAL,
  ]),
  [AGENT_PHASES.EXECUTE]: new Set([
    AGENT_PHASES.NORMALIZE_TOOL_RESULT,
    AGENT_PHASES.FATAL,
  ]),
  [AGENT_PHASES.EXECUTE_PARALLEL]: new Set([
    AGENT_PHASES.NORMALIZE_TOOL_RESULT,
    AGENT_PHASES.FATAL,
  ]),
  [AGENT_PHASES.NORMALIZE_TOOL_RESULT]: new Set([
    AGENT_PHASES.JUDGE,
    AGENT_PHASES.FATAL,
  ]),
  [AGENT_PHASES.JUDGE]: new Set([AGENT_PHASES.ROUTE, AGENT_PHASES.FATAL]),
  [AGENT_PHASES.ROUTE]: new Set([
    AGENT_PHASES.SUPERVISOR,
    AGENT_PHASES.RESEARCH,
    AGENT_PHASES.EXECUTE,
    AGENT_PHASES.EXECUTE_PARALLEL,
    AGENT_PHASES.GENERATE,
    AGENT_PHASES.FATAL,
    AGENT_PHASES.COMPLETE,
  ]),
  [AGENT_PHASES.GENERATE]: new Set([AGENT_PHASES.COMPLETE, AGENT_PHASES.FATAL]),
  [AGENT_PHASES.CHAT]: new Set([AGENT_PHASES.COMPLETE, AGENT_PHASES.FATAL]),
};

export function transitionToPhase(
  phase: AgentPhase,
  updates: AgentStateUpdates = {},
  fromPhase?: AgentPhase,
): Partial<AgentState> {
  // Validate transition if source phase is known
  if (fromPhase) {
    const allowed = VALID_TRANSITIONS[fromPhase];
    if (allowed && !allowed.has(phase)) {
      transitionLogger.warn(
        `Unexpected phase transition: ${fromPhase} → ${phase}`,
      );
    }
  }

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

export function requestPlanReview(
  sessionId: string,
  state: Pick<AgentState, 'plan' | 'objective'>,
): Partial<AgentState> {
  const reviewRequest: ReviewRequest = {
    sessionId,
    plan: state.plan,
    objective: state.objective,
  };
  return transitionToPhase(AGENT_PHASES.AWAIT_PLAN_REVIEW, { reviewRequest });
}
