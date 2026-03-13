import { Logger } from '@nestjs/common';
import { invokeLlm } from '@llm/llm.provider';
import { buildCriticPrompt } from '../prompts/agent.prompts';
import { prettyJson } from '@utils/pretty-log.util';
import { extractJson } from '@utils/json.util';
import { AgentState } from '../state/agent.state';

const logger = new Logger('CriticNode');

interface CriticDecision {
  status: string;
  reason?: string;
  suggested_fix?: string;
  confidence?: number;
  summary?: string;
  message?: string;
}

export async function criticNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const stepNum = (state.currentStep ?? 0) + 1;
  const totalSteps = (state.plan ?? []).length;

  logger.log(
    `Evaluating step ${stepNum}/${totalSteps} for: "${state.input}"`,
  );

  const prompt = buildCriticPrompt(state);
  const raw = await invokeLlm(prompt);

  logger.debug(JSON.stringify(`Raw LLM response:\n${raw}`, null, 2));

  try {
    const decision = extractJson<CriticDecision>(raw);

    logger.log(`Decision → status="${decision.status}"`);

    if (decision.status === 'complete') {
      return {
        status: 'complete',
        done: true,
        finalAnswer: decision.summary ?? 'Task completed successfully.',
      };
    }

    if (decision.status === 'next_step') {
      const nextStepIndex = (state.currentStep ?? 0) + 1;
      const plan = state.plan ?? [];

      if (nextStepIndex >= plan.length) {
        // No more steps — treat as complete
        logger.log('No more steps remaining — marking as complete');
        return {
          status: 'complete',
          done: true,
          finalAnswer:
            decision.reason ?? state.toolResult ?? 'Task completed.',
        };
      }

      const nextStep = plan[nextStepIndex];
      logger.log(
        `Advancing to step ${nextStepIndex + 1}: tool="${nextStep.tool}"`,
      );

      return {
        status: 'running',
        currentStep: nextStepIndex,
        selectedTool: nextStep.tool,
        toolParams: nextStep.input,
      toolInput: prettyJson(nextStep.input),
    };
  }

  if (decision.status === 'retry') {
      logger.warn(`Retry requested: ${decision.reason}`);
      return {
        status: 'retry',
        done: false,
        executionPlan: decision.suggested_fix ?? state.executionPlan,
      };
    }

    if (decision.status === 'error') {
      return {
        status: 'error',
        done: true,
        finalAnswer: decision.message ?? 'Task could not be resolved.',
      };
    }

    // Unknown status — LLM returned wrong field names. Use a heuristic:
    // if the tool result looks like an error, retry; otherwise advance/complete.
    const toolResult = state.toolResult ?? '';
    const looksLikeError =
      toolResult.startsWith('ERROR') ||
      toolResult.startsWith('Tool "') ||
      toolResult.startsWith('error:');

    logger.warn(
      `Unknown critic status "${decision.status}" — heuristic: ${looksLikeError ? 'retry' : 'advance'}`,
    );

    if (looksLikeError) {
      return { status: 'retry', done: false };
    }

    // Treat as next_step (or complete if last step)
    const nextStepIndex = (state.currentStep ?? 0) + 1;
    const plan = state.plan ?? [];
    if (nextStepIndex >= plan.length) {
      return {
        status: 'complete',
        done: true,
        finalAnswer: state.toolResult ?? 'Task completed.',
      };
    }
    const nextStep = plan[nextStepIndex];
    return {
      status: 'running',
      currentStep: nextStepIndex,
      selectedTool: nextStep.tool,
      toolParams: nextStep.input,
      toolInput: prettyJson(nextStep.input),
    };
  } catch {
    logger.error(`Failed to parse critic response: ${raw}`);
    return {
      done: false,
      status: 'retry',
    };
  }
}
