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
  const rawParams: Record<string, unknown> = state.toolParams ?? {};

  // Substitute __PREVIOUS_RESULT__ placeholders with actual previous tool result
  const toolParams: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rawParams)) {
    if (
      typeof value === 'string' &&
      value.includes('__PREVIOUS_RESULT__') &&
      state.toolResultRaw
    ) {
      toolParams[key] = value.replaceAll(
        '__PREVIOUS_RESULT__',
        state.toolResultRaw,
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
  logger.log(`Params: ${preview(prettyJson(rawParams))}`);

  const tool = toolRegistry.get(toolName);

  if (!tool) {
    const errorMsg = `Unknown tool "${toolName}". Available: ${toolRegistry.getNames().join(', ')}`;
    logPhaseEnd('EXECUTOR', `FAILED: ${errorMsg}`, elapsed());
    return {
      phase: 'normalize_tool_result',
      toolResultRaw: `ERROR: ${errorMsg}`,
      counters: {
        ...(state.counters ?? {
          turn: 0,
          toolCalls: 0,
          replans: 0,
          stepRetries: 0,
        }),
        toolCalls: (state.counters?.toolCalls ?? 0) + 1,
      },
      errors: [
        {
          code: 'tool_error',
          message: errorMsg,
          atPhase: 'execute',
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

    const resultPreview = preview(result);
    logPhaseEnd('EXECUTOR', `OK (${result.length} chars)`, elapsed());
    logger.debug(`Result:\n${resultPreview}`);

    return {
      phase: 'normalize_tool_result',
      toolResultRaw: result,
      counters: {
        ...(state.counters ?? {
          turn: 0,
          toolCalls: 0,
          replans: 0,
          stepRetries: 0,
        }),
        toolCalls: (state.counters?.toolCalls ?? 0) + 1,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const errorResult = `Tool "${toolName}" failed: ${message}`;
    logPhaseEnd('EXECUTOR', `ERROR: ${message}`, elapsed());
    return {
      phase: 'normalize_tool_result',
      toolResultRaw: `ERROR: ${errorResult}`,
      counters: {
        ...(state.counters ?? {
          turn: 0,
          toolCalls: 0,
          replans: 0,
          stepRetries: 0,
        }),
        toolCalls: (state.counters?.toolCalls ?? 0) + 1,
      },
      errors: [
        {
          code: 'tool_error',
          message: errorResult,
          atPhase: 'execute',
        },
      ],
    };
  }
}
