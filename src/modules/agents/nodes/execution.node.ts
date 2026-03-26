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
import { incrementAgentCounters } from '../state/agent-state.helpers';
import { AGENT_PHASES } from '../state/agent-phase';
import { transitionToPhase } from '../state/agent-transition.util';

const logger = new Logger('Executor');

/**
 * Extract the first inline file content block from a user message.
 * Handles both [Attached: name] and [File: name] forms followed by a code fence.
 * Falls back to the full input if no block is found.
 */
function extractInlineContent(input: string): string {
  const match = input.match(
    /\[(?:Attached|File):[^\]]*\]\s*```(?:\w+)?\s*([\s\S]*?)```/,
  );
  return match ? match[1].trim() : input;
}

export async function executionNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const elapsed = startTimer();
  const toolName = state.selectedTool ?? '';
  const rawParams: Record<string, unknown> = state.toolParams ?? {};

  // Substitute __PREVIOUS_RESULT__ and __INLINE_CONTENT__ placeholders
  const toolParams: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rawParams)) {
    if (typeof value === 'string') {
      let resolved = value;
      if (resolved.includes('__PREVIOUS_RESULT__') && state.toolResultRaw) {
        resolved = resolved.replaceAll('__PREVIOUS_RESULT__', state.toolResultRaw);
      }
      if (resolved.includes('__INLINE_CONTENT__') && state.input) {
        resolved = resolved.replaceAll('__INLINE_CONTENT__', extractInlineContent(state.input));
      }
      toolParams[key] = resolved;
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
    return transitionToPhase(AGENT_PHASES.NORMALIZE_TOOL_RESULT, {
      toolResultRaw: `ERROR: ${errorMsg}`,
      counters: incrementAgentCounters(state.counters, { toolCalls: 1 }),
      errors: [
        {
          code: 'tool_error',
          message: errorMsg,
          atPhase: AGENT_PHASES.EXECUTE,
        },
      ],
    });
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

    return transitionToPhase(AGENT_PHASES.NORMALIZE_TOOL_RESULT, {
      toolResultRaw: result,
      counters: incrementAgentCounters(state.counters, { toolCalls: 1 }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const errorResult = `Tool "${toolName}" failed: ${message}`;
    logPhaseEnd('EXECUTOR', `ERROR: ${message}`, elapsed());

    const details: Record<string, unknown> = { tool: toolName };
    if (error instanceof Error) {
      if ('code' in error) details.code = (error as any).code;
      if ('statusCode' in error) details.statusCode = (error as any).statusCode;
      details.stack = error.stack?.split('\n').slice(0, 3).join('\n');
    }

    return transitionToPhase(AGENT_PHASES.NORMALIZE_TOOL_RESULT, {
      toolResultRaw: `ERROR: ${errorResult}`,
      counters: incrementAgentCounters(state.counters, { toolCalls: 1 }),
      errors: [
        {
          code:
            error instanceof Error && 'code' in error
              ? 'tool_error'
              : 'tool_error',
          message: errorResult,
          atPhase: AGENT_PHASES.EXECUTE,
          details,
        },
      ],
    });
  }
}
