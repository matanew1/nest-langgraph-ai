import { Logger } from '@nestjs/common';
import { invokeLlm } from '@llm/llm.provider';
import { buildCriticPrompt } from '../prompts/agent.prompts';
import {
  prettyJson,
  logPhaseStart,
  logPhaseEnd,
  startTimer,
  preview,
} from '@utils/pretty-log.util';
import { extractJson } from '@utils/json.util';
import { AgentState } from '../state/agent.state';
import { env } from '@config/env';

const logger = new Logger('Critic');

interface CriticDecision {
  status: string;
  reason?: string;
  suggested_fix?: string;
  summary?: string;
  message?: string;
}

export async function criticNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const elapsed = startTimer();
  const stepNum = (state.currentStep ?? 0) + 1;
  const totalSteps = (state.plan ?? []).length;

  logPhaseStart('CRITIC', `evaluating step ${stepNum}/${totalSteps}`);

  // AUTO-COMPLETE: If plan exhausted, finish without LLM
  if ((state.currentStep ?? 0) >= totalSteps) {
    logPhaseEnd('CRITIC', 'AUTO-COMPLETE (plan exhausted)', elapsed());
    return {
      status: 'complete',
      done: true,
      finalAnswer: `Completed all ${totalSteps} steps in the plan. Final tool result: ${preview(state.toolResult ?? 'N/A')}`,
      consecutiveRetries: 0,
    };
  }

  const prompt = buildCriticPrompt(state);
  const raw = await invokeLlm(prompt);

  logger.debug(`LLM response:\n${preview(raw)}`);

  try {
    const decision = extractJson<CriticDecision>(raw);

    // ── COMPLETE ──
    if (decision.status === 'complete') {
      logPhaseEnd(
        'CRITIC',
        `COMPLETE: ${preview(decision.summary ?? '')}`,
        elapsed(),
      );
      return {
        status: 'complete',
        done: true,
        finalAnswer: decision.summary ?? 'Task completed successfully.',
        consecutiveRetries: 0,
      };
    }

    // ── NEXT STEP ──
    if (decision.status === 'next_step') {
      const nextStepIndex = (state.currentStep ?? 0) + 1;
      const plan = state.plan ?? [];

      if (nextStepIndex >= plan.length) {
        logPhaseEnd('CRITIC', 'COMPLETE (no more steps)', elapsed());
        return {
          status: 'complete',
          done: true,
          finalAnswer: decision.reason ?? state.toolResult ?? 'Task completed.',
          consecutiveRetries: 0,
        };
      }

      const nextStep = plan[nextStepIndex];
      logPhaseEnd(
        'CRITIC',
        `NEXT → step ${nextStepIndex + 1} [${nextStep.tool}]`,
        elapsed(),
      );

      return {
        status: 'running',
        currentStep: nextStepIndex,
        selectedTool: nextStep.tool,
        toolParams: nextStep.input,
        toolInput: prettyJson(nextStep.input),
        consecutiveRetries: 0, // Reset on advance
      };
    }

    // ── RETRY ── with Circuit Breaker
    if (decision.status === 'retry') {
      const currentRetries = state.consecutiveRetries ?? 0;
      const stepId = state.plan?.[state.currentStep ?? 0]?.step_id ?? -1;
      if (currentRetries >= env.agentMaxRetries) {
        logPhaseEnd(
          'CRITIC',
          `CIRCUIT BREAKER: ${currentRetries} retries on step ${stepId + 1}`,
          elapsed(),
        );
        return {
          status: 'error',
          done: true,
          finalAnswer: `Circuit breaker triggered: stuck in retry loop (${currentRetries} attempts) on step ${stepId + 1}.`,
        };
      }
      logPhaseEnd(
        'CRITIC',
        `RETRY [${currentRetries + 1}/3]: ${decision.reason}`,
        elapsed(),
      );
      return {
        status: 'retry',
        done: false,
        consecutiveRetries: currentRetries + 1,
        executionPlan: decision.suggested_fix ?? state.executionPlan,
      };
    }

    // ── ERROR ──
    if (decision.status === 'error') {
      logPhaseEnd('CRITIC', `ERROR: ${decision.message}`, elapsed());
      return {
        status: 'error',
        done: true,
        finalAnswer: decision.message ?? 'Task could not be resolved.',
      };
    }

    // ── UNKNOWN STATUS — heuristic fallback ──
    const toolResult = state.toolResult ?? '';
    const looksLikeError =
      toolResult.startsWith('ERROR') ||
      toolResult.startsWith('Tool "') ||
      toolResult.startsWith('error:');

    logger.warn(
      `Unknown status "${decision.status}" → heuristic: ${looksLikeError ? 'retry' : 'advance'}`,
    );

    if (looksLikeError) {
      const currentRetries = state.consecutiveRetries ?? 0;
      const stepId = state.plan?.[state.currentStep ?? 0]?.step_id ?? -1;
      if (currentRetries >= env.agentMaxRetries) {
        logPhaseEnd(
          'CRITIC',
          `CIRCUIT BREAKER (heuristic): ${currentRetries} retries on step ${stepId + 1}`,
          elapsed(),
        );
        return {
          status: 'error',
          done: true,
          finalAnswer: `Circuit breaker (heuristic): stuck retry (${currentRetries} attempts) on step ${stepId + 1}.`,
        };
      }
      logPhaseEnd(
        'CRITIC',
        `RETRY (heuristic) [${currentRetries + 1}/3]`,
        elapsed(),
      );
      return {
        status: 'retry',
        done: false,
        consecutiveRetries: currentRetries + 1,
      };
    }

    // Treat as next_step (or complete if last step)
    const nextStepIndex = (state.currentStep ?? 0) + 1;
    const plan = state.plan ?? [];
    if (nextStepIndex >= plan.length) {
      logPhaseEnd('CRITIC', 'COMPLETE (heuristic, last step)', elapsed());
      return {
        status: 'complete',
        done: true,
        finalAnswer: state.toolResult ?? 'Task completed.',
      };
    }
    const nextStep = plan[nextStepIndex];
    logPhaseEnd(
      'CRITIC',
      `NEXT → step ${nextStepIndex + 1} (heuristic)`,
      elapsed(),
    );
    return {
      status: 'running',
      currentStep: nextStepIndex,
      selectedTool: nextStep.tool,
      toolParams: nextStep.input,
      toolInput: prettyJson(nextStep.input),
      consecutiveRetries: 0, // Reset on advance
    };
  } catch {
    logPhaseEnd('CRITIC', 'PARSE FAILED → retry', elapsed());
    logger.error(`Raw response: ${preview(raw)}`);
    const currentRetries = state.consecutiveRetries ?? 0;
    const stepId = state.plan?.[state.currentStep ?? 0]?.step_id ?? -1;
    if (currentRetries >= env.agentMaxRetries) {
      return {
        status: 'error',
        done: true,
        finalAnswer: `Circuit breaker (parse fail): max retries exceeded on step ${stepId + 1}.`,
      };
    }
    return {
      done: false,
      status: 'retry',
      consecutiveRetries: currentRetries + 1,
    };
  }
}
