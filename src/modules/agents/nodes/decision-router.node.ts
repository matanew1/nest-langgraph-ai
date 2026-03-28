import type { AgentState, AgentCounters, PlanStep } from '../state/agent.state';
import { logPhaseEnd, logPhaseStart, startTimer } from '@utils/pretty-log.util';
import { getAgentLimits } from '../graph/agent.config';
import { AGENT_PHASES } from '../state/agent-phase';
import {
  getAgentCounters,
  incrementAgentCounters,
} from '../state/agent-state.helpers';
import {
  beginExecutionStep,
  failAgentRun,
  transitionToPhase,
} from '../state/agent-transition.util';

const ROUTER_LIMIT_CHECKS = [
  { counterKey: 'turn', limitKey: 'turns', label: 'max recovery turns' },
  { counterKey: 'toolCalls', limitKey: 'toolCalls', label: 'max tool calls' },
  { counterKey: 'replans', limitKey: 'replans', label: 'max replans' },
  {
    counterKey: 'stepRetries',
    limitKey: 'stepRetries',
    label: 'max step retries',
  },
  {
    counterKey: 'supervisorFallbacks',
    limitKey: 'supervisorFallbacks',
    label: 'max supervisor fallbacks',
  },
] as const;

/* ------------------------------------------------------------------ */
/*  Decision handlers — pure functions returning state updates         */
/* ------------------------------------------------------------------ */

function advanceToNextStep(
  plan: PlanStep[],
  currentStep: number,
): Partial<AgentState> {
  const nextStepIndex = currentStep + 1;
  if (nextStepIndex >= plan.length) {
    return transitionToPhase(AGENT_PHASES.GENERATE, {
      criticDecision: undefined,
      replanContext: undefined,
    });
  }

  const nextStep = plan[nextStepIndex];
  if (nextStep.parallel_group !== undefined) {
    return transitionToPhase(AGENT_PHASES.EXECUTE_PARALLEL, {
      currentStep: nextStepIndex,
      criticDecision: undefined,
      replanContext: undefined,
    });
  }
  return beginExecutionStep(nextStep, nextStepIndex, {
    criticDecision: undefined,
    replanContext: undefined,
  });
}

function handleComplete(
  plan: PlanStep[],
  currentStep: number,
  isLastStep: boolean,
): Partial<AgentState> {
  // Guard against premature completion: critic must only complete on last step.
  if (!isLastStep) {
    return advanceToNextStep(plan, currentStep);
  }
  return transitionToPhase(AGENT_PHASES.GENERATE, {
    criticDecision: undefined,
    replanContext: undefined,
  });
}

function handleFatal(
  decision: NonNullable<AgentState['criticDecision']>,
): Partial<AgentState> {
  return failAgentRun(
    decision.finalAnswer ?? 'Stopped due to a fatal decision.',
    {
      code: 'unknown',
      message: decision.reason,
      atPhase: AGENT_PHASES.ROUTE,
    },
  );
}

function handleReplan(
  counters: AgentCounters,
  reason?: string,
): Partial<AgentState> {
  return transitionToPhase(AGENT_PHASES.RESEARCH, {
    memoryContext: undefined,
    replanContext: reason,
    counters: incrementAgentCounters(counters, { replans: 1, turn: 1 }),
    criticDecision: undefined,
  });
}

function handleRetryStep(
  state: AgentState,
  counters: AgentCounters,
): Partial<AgentState> {
  const currentTool = state.selectedTool ?? '';
  const currentStepIdx = state.currentStep ?? 0;
  const currentGeneration = counters.replans;
  const criticReason = state.criticDecision?.reason;

  // If the tool ran without error but its output was still not useful (ok: true),
  // retrying with the same params will produce the same result. Escalate immediately.
  if (state.toolResult?.ok === true) {
    return handleReplan(counters, criticReason);
  }

  // Deterministic loop prevention: if this step+tool combination has already been
  // attempted ≥2 times with a real error, the params will never change. Escalate.
  // Uses replanGeneration to avoid counter reset after replans.
  const priorAttemptsForStep = (state.attempts ?? []).filter(
    (a) =>
      a.step === currentStepIdx &&
      a.tool === currentTool &&
      (a.replanGeneration ?? 0) === currentGeneration,
  );

  if (priorAttemptsForStep.length >= 2) {
    return handleReplan(counters, criticReason);
  }

  return transitionToPhase(AGENT_PHASES.EXECUTE, {
    counters: incrementAgentCounters(counters, {
      stepRetries: 1,
      turn: 1,
    }),
    criticDecision: undefined,
  });
}

/* ------------------------------------------------------------------ */
/*  Main router node                                                   */
/* ------------------------------------------------------------------ */

/**
 * Deterministic routing step.
 *
 * Enforces global limits (deadlock protection) and converts the
 * critic's decision into the next `phase` + state updates.
 */
export async function decisionRouterNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const elapsed = startTimer();
  logPhaseStart('DECISION_ROUTER', `phase=${state.phase}`);

  // Terminal phases must never be re-routed — the graph topology ends here.
  if (
    state.phase === AGENT_PHASES.COMPLETE ||
    state.phase === AGENT_PHASES.FATAL
  ) {
    logPhaseEnd(
      'DECISION_ROUTER',
      `TERMINAL (${state.phase}) → skip`,
      elapsed(),
    );
    return {};
  }

  const counters = getAgentCounters(state.counters);
  const AGENT_LIMITS = getAgentLimits();

  // Check global limits — deadlock protection
  for (const check of ROUTER_LIMIT_CHECKS) {
    const current = counters[check.counterKey];
    const limit = AGENT_LIMITS[check.limitKey];

    if (current >= limit) {
      logPhaseEnd('DECISION_ROUTER', `FATAL: ${check.label}`, elapsed());
      return failAgentRun(`Stopped: exceeded ${check.label} (${limit}).`, {
        code: 'timeout',
        message: `Exceeded ${check.label}`,
        atPhase: AGENT_PHASES.ROUTE,
        details: { counters, limits: AGENT_LIMITS },
      });
    }
  }

  const decision = state.criticDecision;
  if (!decision) {
    if (state.phase === AGENT_PHASES.ROUTE) {
      logPhaseEnd(
        'DECISION_ROUTER',
        'NO DECISION → SUPERVISOR FALLBACK',
        elapsed(),
      );
      return transitionToPhase(AGENT_PHASES.SUPERVISOR, {
        counters: incrementAgentCounters(counters, {
          supervisorFallbacks: 1,
          turn: 1,
        }),
      });
    }
    logPhaseEnd('DECISION_ROUTER', 'NO DECISION → continue', elapsed());
    return {};
  }

  const plan = state.plan ?? [];
  const currentStep = state.currentStep ?? 0;
  const isLastStep = plan.length === 0 ? true : currentStep >= plan.length - 1;

  let result: Partial<AgentState>;
  let logSuffix: string;

  switch (decision.decision) {
    case 'complete':
      logSuffix = isLastStep
        ? 'COMPLETE → GENERATE'
        : `PREMATURE COMPLETE → ADVANCE → step ${currentStep + 2}`;
      result = handleComplete(plan, currentStep, isLastStep);
      break;

    case 'fatal':
      logSuffix = 'FATAL';
      result = handleFatal(decision);
      break;

    case 'replan':
      logSuffix = 'REPLAN → research';
      result = handleReplan(counters, decision.reason);
      break;

    case 'retry_step':
      logSuffix = 'RETRY_STEP';
      result = handleRetryStep(state, counters);
      break;

    default:
      // advance
      logSuffix =
        currentStep + 1 >= plan.length
          ? 'ADVANCE (plan exhausted) → GENERATE'
          : `ADVANCE → step ${currentStep + 2}`;
      result = advanceToNextStep(plan, currentStep);
      break;
  }

  logPhaseEnd('DECISION_ROUTER', logSuffix, elapsed());
  return result;
}
