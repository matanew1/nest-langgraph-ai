import type { AgentState } from '../state/agent.state';
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

/**
 * Deterministic routing step.
 *
 * This node enforces global limits (deadlock protection) and converts the
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
    // If there is no critic decision yet, continue to next deterministic phase.
    // If the phase is 'route' (meaning no node changed it), it's a supervisor fallback.
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

  if (decision.decision === 'complete') {
    // Guard against premature completion: critic must only complete on last step.
    // If it tries to complete early, treat it as an advance.
    if (!isLastStep) {
      const nextStepIndex = currentStep + 1;
      const nextStep = plan[nextStepIndex];
      if (!nextStep) {
        logPhaseEnd(
          'DECISION_ROUTER',
          'COMPLETE (plan exhausted) → GENERATE',
          elapsed(),
        );
        return transitionToPhase(AGENT_PHASES.GENERATE, {
          criticDecision: undefined,
        });
      }

      logPhaseEnd(
        'DECISION_ROUTER',
        `PREMATURE COMPLETE → ADVANCE → step ${nextStepIndex + 1}`,
        elapsed(),
      );
      if (nextStep.parallel_group !== undefined) {
        return transitionToPhase(AGENT_PHASES.EXECUTE_PARALLEL, {
          currentStep: nextStepIndex,
          criticDecision: undefined,
        });
      }
      return beginExecutionStep(nextStep, nextStepIndex, {
        criticDecision: undefined,
      });
    }

    logPhaseEnd('DECISION_ROUTER', 'COMPLETE → GENERATE', elapsed());
    return transitionToPhase(AGENT_PHASES.GENERATE, {
      criticDecision: undefined,
    });
  }

  if (decision.decision === 'fatal') {
    logPhaseEnd('DECISION_ROUTER', 'FATAL', elapsed());
    return failAgentRun(
      decision.finalAnswer ?? 'Stopped due to a fatal decision.',
      {
        code: 'unknown',
        message: decision.reason,
        atPhase: AGENT_PHASES.ROUTE,
      },
    );
  }

  if (decision.decision === 'replan') {
    logPhaseEnd('DECISION_ROUTER', 'REPLAN → research', elapsed());
    return transitionToPhase(AGENT_PHASES.RESEARCH, {
      memoryContext: undefined,
      counters: incrementAgentCounters(counters, { replans: 1, turn: 1 }),
      criticDecision: undefined,
    });
  }

  // retry_step always falls back to serial EXECUTE even for parallel-group steps.
  // This is intentional: a failed parallel group should retry the single failing step
  // rather than re-running the entire group.
  if (decision.decision === 'retry_step') {
    logPhaseEnd('DECISION_ROUTER', 'RETRY_STEP → execute', elapsed());
    return transitionToPhase(AGENT_PHASES.EXECUTE, {
      counters: incrementAgentCounters(counters, {
        stepRetries: 1,
        turn: 1,
      }),
      criticDecision: undefined,
    });
  }

  // advance
  const nextStepIndex = currentStep + 1;
  if (nextStepIndex >= plan.length) {
    logPhaseEnd(
      'DECISION_ROUTER',
      'ADVANCE (plan exhausted) → GENERATE',
      elapsed(),
    );
    return transitionToPhase(AGENT_PHASES.GENERATE, {
      criticDecision: undefined,
    });
  }

  const nextStep = plan[nextStepIndex];
  logPhaseEnd(
    'DECISION_ROUTER',
    `ADVANCE → step ${nextStepIndex + 1}`,
    elapsed(),
  );
  if (nextStep.parallel_group !== undefined) {
    return transitionToPhase(AGENT_PHASES.EXECUTE_PARALLEL, {
      currentStep: nextStepIndex,
      criticDecision: undefined,
    });
  }
  return beginExecutionStep(nextStep, nextStepIndex, {
    criticDecision: undefined,
  });
}
