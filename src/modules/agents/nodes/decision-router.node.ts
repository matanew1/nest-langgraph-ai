import type { AgentState } from '../state/agent.state';
import { logPhaseEnd, logPhaseStart, startTimer } from '@utils/pretty-log.util';
import { getAgentLimits } from '../graph/agent.config';

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

  const counters = state.counters ?? {
    turn: 0,
    toolCalls: 0,
    replans: 0,
    stepRetries: 0,
  };

  const AGENT_LIMITS = getAgentLimits();

  // Hard stops
  if (counters.turn >= AGENT_LIMITS.turns) {
    logPhaseEnd('DECISION_ROUTER', 'FATAL: max turns', elapsed());
    return {
      phase: 'fatal',
      finalAnswer: `Stopped: exceeded max turns (${AGENT_LIMITS.turns}).`,
      errors: [
        {
          code: 'timeout',
          message: 'Exceeded max turns',
          atPhase: 'route',
          details: { counters, limits: AGENT_LIMITS },
        },
      ],
    };
  }
  if (counters.toolCalls >= AGENT_LIMITS.toolCalls) {
    logPhaseEnd('DECISION_ROUTER', 'FATAL: max tool calls', elapsed());
    return {
      phase: 'fatal',
      finalAnswer: `Stopped: exceeded max tool calls (${AGENT_LIMITS.toolCalls}).`,
      errors: [
        {
          code: 'timeout',
          message: 'Exceeded max tool calls',
          atPhase: 'route',
          details: { counters, limits: AGENT_LIMITS },
        },
      ],
    };
  }
  if (counters.replans >= AGENT_LIMITS.replans) {
    logPhaseEnd('DECISION_ROUTER', 'FATAL: max replans', elapsed());
    return {
      phase: 'fatal',
      finalAnswer: `Stopped: exceeded max replans (${AGENT_LIMITS.replans}).`,
      errors: [
        {
          code: 'timeout',
          message: 'Exceeded max replans',
          atPhase: 'route',
          details: { counters, limits: AGENT_LIMITS },
        },
      ],
    };
  }
  if (counters.stepRetries >= AGENT_LIMITS.stepRetries) {
    logPhaseEnd('DECISION_ROUTER', 'FATAL: max step retries', elapsed());
    return {
      phase: 'fatal',
      finalAnswer: `Stopped: exceeded max step retries (${AGENT_LIMITS.stepRetries}).`,
      errors: [
        {
          code: 'timeout',
          message: 'Exceeded max step retries',
          atPhase: 'route',
          details: { counters, limits: AGENT_LIMITS },
        },
      ],
    };
  }

  // JSON repair path: originating node sets jsonRepair + phase=route.
  if (state.jsonRepair) {
    logPhaseEnd('DECISION_ROUTER', 'ROUTE → json_repair', elapsed());
    return { phase: 'route' };
  }

  // If we have a repaired JSON payload, route back to the originating phase so
  // the originating node re-runs and picks up jsonRepairResult instead of
  // calling the LLM again.
  if (state.jsonRepairResult !== undefined) {
    const fromPhase = state.jsonRepairFromPhase;
    logPhaseEnd(
      'DECISION_ROUTER',
      `ROUTE → replay repaired JSON at phase=${fromPhase}`,
      elapsed(),
    );
    return {
      phase: fromPhase,
      jsonRepairResult: state.jsonRepairResult,
      jsonRepairFromPhase: undefined,
    };
  }

  const decision = state.criticDecision;
  if (!decision) {
    // If there is no critic decision yet, continue to next deterministic phase.
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
        logPhaseEnd('DECISION_ROUTER', 'COMPLETE (plan exhausted)', elapsed());
        return {
          phase: 'complete',
          finalAnswer:
            decision.finalAnswer ?? state.toolResult?.preview ?? 'Completed.',
          criticDecision: undefined,
        };
      }

      logPhaseEnd(
        'DECISION_ROUTER',
        `PREMATURE COMPLETE → ADVANCE → step ${nextStepIndex + 1}`,
        elapsed(),
      );
      return {
        phase: 'execute',
        currentStep: nextStepIndex,
        selectedTool: nextStep.tool,
        toolParams: nextStep.input,
        counters: {
          ...counters,
          turn: counters.turn + 1,
        },
        criticDecision: undefined,
      };
    }

    logPhaseEnd('DECISION_ROUTER', 'COMPLETE', elapsed());
    return {
      phase: 'complete',
      finalAnswer: decision.finalAnswer,
    };
  }

  if (decision.decision === 'fatal') {
    logPhaseEnd('DECISION_ROUTER', 'FATAL', elapsed());
    return {
      phase: 'fatal',
      finalAnswer: decision.finalAnswer,
      errors: [
        {
          code: 'unknown',
          message: decision.reason,
          atPhase: 'route',
        },
      ],
    };
  }

  if (decision.decision === 'replan') {
    logPhaseEnd('DECISION_ROUTER', 'REPLAN → plan', elapsed());
    return {
      phase: 'plan',
      projectContext: undefined,
      counters: {
        ...counters,
        replans: counters.replans + 1,
        turn: counters.turn + 1,
      },
      criticDecision: undefined,
    };
  }

  if (decision.decision === 'retry_step') {
    logPhaseEnd('DECISION_ROUTER', 'RETRY_STEP → execute', elapsed());
    return {
      phase: 'execute',
      counters: {
        ...counters,
        stepRetries: counters.stepRetries + 1,
        turn: counters.turn + 1,
      },
      criticDecision: undefined,
    };
  }

  // advance
  const nextStepIndex = currentStep + 1;
  if (nextStepIndex >= plan.length) {
    logPhaseEnd('DECISION_ROUTER', 'COMPLETE (plan exhausted)', elapsed());
    return {
      phase: 'complete',
      finalAnswer: state.toolResult?.preview ?? 'Completed.',
      criticDecision: undefined,
    };
  }

  const nextStep = plan[nextStepIndex];
  logPhaseEnd(
    'DECISION_ROUTER',
    `ADVANCE → step ${nextStepIndex + 1}`,
    elapsed(),
  );
  return {
    phase: 'execute',
    currentStep: nextStepIndex,
    selectedTool: nextStep.tool,
    toolParams: nextStep.input,
    counters: {
      ...counters,
      turn: counters.turn + 1,
    },
    criticDecision: undefined,
  };
}
