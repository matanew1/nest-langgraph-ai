import { Logger } from '@nestjs/common';
import type { AgentState } from '../state/agent.state';
import { toolRegistry } from '../tools/index';
import { env } from '@config/env';
import {
  prettyJson,
  preview,
  logPhaseStart,
  logPhaseEnd,
  startTimer,
} from '@utils/pretty-log.util';

const logger = new Logger('Executor');

export async function executionNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const elapsed = startTimer();
  const toolName = state.selectedTool ?? '';
  const rawParams: Record<string, unknown> = state.toolParams ?? {
    query: state.toolInput ?? '',
  };

  // Substitute __PREVIOUS_RESULT__ placeholders with actual previous tool result
  const toolParams: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rawParams)) {
    if (
      typeof value === 'string' &&
      value.includes('__PREVIOUS_RESULT__') &&
      state.toolResult
    ) {
      toolParams[key] = value.replaceAll(
        '__PREVIOUS_RESULT__',
        state.toolResult,
      );
    } else {
      toolParams[key] = value;
    }
  }

  const stepNum = (state.currentStep ?? 0) + 1;
  const totalSteps = (state.plan ?? []).length;

  logPhaseStart(
    'EXECUTOR',
    `step ${stepNum}/${totalSteps} | tool="${toolName}"`,
  );
  logger.log(`Params: ${preview(prettyJson(rawParams), 200)}`);

  const tool = toolRegistry.get(toolName);

  if (!tool) {
    const errorMsg = `Unknown tool "${toolName}". Available: ${toolRegistry.getNames().join(', ')}`;
    logPhaseEnd('EXECUTOR', `FAILED: ${errorMsg}`, elapsed());
    return {
      toolResult: errorMsg,
      lastToolErrored: true,
      attempts: [
        {
          tool: toolName,
          input: prettyJson(rawParams),
          params: rawParams,
          result: errorMsg,
          error: true,
        },
      ],
    };
  }

  try {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, env.toolTimeoutMs);
    let result: string;
    try {
      result = (await tool.invoke(toolParams, {
        signal: controller.signal,
      })) as string;
    } finally {
      clearTimeout(timer);
    }
    if (timedOut) {
      throw new Error(
        `Tool "${toolName}" timed out after ${env.toolTimeoutMs}ms`,
      );
    }

    const resultPreview = preview(result, 300);
    logPhaseEnd('EXECUTOR', `OK (${result.length} chars)`, elapsed());
    logger.debug(`Result:\n${resultPreview}`);

    return {
      toolResult: result,
      lastToolErrored: false,
      attempts: [
        {
          tool: toolName,
          input: prettyJson(rawParams),
          params: rawParams,
          result: resultPreview,
          error: false,
        },
      ],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const errorResult = `Tool "${toolName}" failed: ${message}`;
    logPhaseEnd('EXECUTOR', `ERROR: ${message}`, elapsed());
    return {
      toolResult: errorResult,
      lastToolErrored: true,
      attempts: [
        {
          tool: toolName,
          input: prettyJson(rawParams),
          params: rawParams,
          result: errorResult,
          error: true,
        },
      ],
    };
  }
}
