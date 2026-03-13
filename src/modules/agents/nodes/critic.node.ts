import { Logger } from '@nestjs/common';
import { invokeLlm } from '@llm/llm.provider';
import { buildCriticPrompt } from '../prompts/agent.prompts';
import { prettyJson, logPhaseStart, logPhaseEnd, startTimer, preview } from '@utils/pretty-log.util';
import { extractJson } from '@utils/json.util';
import { AgentState } from '../state/agent.state';

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

  const prompt = buildCriticPrompt(state);
  const raw = await invokeLlm(prompt);

  logger.debug(`LLM response: ${preview(raw, 300)}`);

  try {
    const decision = extractJson<CriticDecision>(raw);

    // ── COMPLETE ──
    if (decision.status === 'complete') {
      logPhaseEnd('CRITIC', `COMPLETE: ${preview(decision.summary ?? '', 100)}`, elapsed());
      return {
        status: 'complete',
        done: true,
        finalAnswer: decision.summary ?? 'Task completed successfully.',
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
          finalAnswer:
            decision.reason ?? state.toolResult ?? 'Task completed.',
        };
      }

      const nextStep = plan[nextStepIndex];
      logPhaseEnd('CRITIC', `NEXT → step ${nextStepIndex + 1} [${nextStep.tool}]`, elapsed());

      return {
        status: 'running',
        currentStep: nextStepIndex,
        selectedTool: nextStep.tool,
        toolParams: nextStep.input,
        toolInput: prettyJson(nextStep.input),
      };
    }

    // ── RETRY ──
    if (decision.status === 'retry') {
      logPhaseEnd('CRITIC', `RETRY: ${decision.reason}`, elapsed());
      return {
        status: 'retry',
        done: false,
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
      logPhaseEnd('CRITIC', 'RETRY (heuristic)', elapsed());
      return { status: 'retry', done: false };
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
    logPhaseEnd('CRITIC', `NEXT → step ${nextStepIndex + 1} (heuristic)`, elapsed());
    return {
      status: 'running',
      currentStep: nextStepIndex,
      selectedTool: nextStep.tool,
      toolParams: nextStep.input,
      toolInput: prettyJson(nextStep.input),
    };
  } catch {
    logPhaseEnd('CRITIC', 'PARSE FAILED → retry', elapsed());
    logger.error(`Raw response: ${preview(raw, 500)}`);
    return {
      done: false,
      status: 'retry',
    };
  }
}
