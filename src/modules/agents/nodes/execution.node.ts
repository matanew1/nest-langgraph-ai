import { Logger } from '@nestjs/common';
import type { AgentState } from '../state/agent.state';
import { toolRegistry } from '../tools/index';
import { env } from '@config/env';
import { prettyJson, preview } from '@utils/pretty-log.util';

const logger = new Logger('ExecutionNode');

const ATTEMPT_PREVIEW_LENGTH = 300;

export async function executionNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const toolName = state.selectedTool ?? '';
  const rawParams: Record<string, unknown> = state.toolParams ?? {
    query: state.toolInput ?? '',
  };

  // Substitute __PREVIOUS_RESULT__ placeholders with actual previous tool result
  const toolParams: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rawParams)) {
    if (value === '__PREVIOUS_RESULT__' && state.toolResult) {
      toolParams[key] = state.toolResult;
    } else {
      toolParams[key] = value;
    }
  }

  const stepNum = (state.currentStep ?? 0) + 1;
  const totalSteps = (state.plan ?? []).length;

  logger.log(
    `Executing step ${stepNum}/${totalSteps}: tool="${toolName}" with params=${preview(prettyJson(rawParams), 200)}`,
  );

  const tool = toolRegistry.get(toolName);

  if (!tool) {
    const errorMsg = `Unknown tool "${toolName}". Available: ${toolRegistry.getNames().join(', ')}`;
    logger.warn(errorMsg);
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
    const timer = setTimeout(() => controller.abort(), env.toolTimeoutMs);
    let result: string;
    try {
      result = (await tool.invoke(toolParams, {
        signal: controller.signal,
      })) as string;
    } finally {
      clearTimeout(timer);
    }
    if (controller.signal.aborted) {
      throw new Error(
        `Tool "${toolName}" timed out after ${env.toolTimeoutMs}ms`,
      );
    }

    const preview =
      result.length > ATTEMPT_PREVIEW_LENGTH
        ? result.slice(0, ATTEMPT_PREVIEW_LENGTH) + '…'
        : result;

    logger.debug(`Tool result preview: ${preview}`);
    return {
      toolResult: result,
      lastToolErrored: false,
      attempts: [
        {
          tool: toolName,
          input: prettyJson(rawParams),
          params: rawParams,
          result: preview,
          error: false,
        },
      ],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Tool "${toolName}" failed: ${message}`);
    const errorResult = `Tool "${toolName}" failed: ${message}`;
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
