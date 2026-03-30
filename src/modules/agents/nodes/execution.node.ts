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
import { isZodArrayField, coerceToStringArray } from '@utils/zod-coerce.util';
import { incrementAgentCounters } from '../state/agent-state.helpers';
import { AGENT_PHASES } from '../state/agent-phase';
import { transitionToPhase } from '../state/agent-transition.util';
import { extractInlineContent, INLINE_NOT_FOUND } from './inline-content.util';

const logger = new Logger('Executor');

export async function executionNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const elapsed = startTimer();
  const toolName = state.selectedTool ?? '';
  const rawParams: Record<string, unknown> = state.toolParams ?? {};

  // Substitute __PREVIOUS_RESULT__ and __INLINE_CONTENT__ placeholders
  const toolParams: Record<string, unknown> = {};
  const resolvedFromPlaceholder = new Set<string>();
  for (const [key, value] of Object.entries(rawParams)) {
    if (typeof value === 'string') {
      let resolved = value;
      if (resolved.includes('__PREVIOUS_RESULT__') && state.toolResultRaw) {
        resolved = resolved.replaceAll('__PREVIOUS_RESULT__', state.toolResultRaw);
        resolvedFromPlaceholder.add(key);
      }
      if (resolved.includes('__INLINE_CONTENT__') && state.input) {
        const extracted = extractInlineContent(state.input);
        if (extracted === INLINE_NOT_FOUND) {
          const errorMsg =
            'ERROR: __INLINE_CONTENT__ could not be resolved — no attached file block found in the user message. ' +
            'The plan must be revised to read the target file from disk using read_file instead of relying on inline content.';
          logPhaseEnd('EXECUTOR', 'FAILED: inline content missing', elapsed());
          return transitionToPhase(AGENT_PHASES.NORMALIZE_TOOL_RESULT, {
            toolResultRaw: errorMsg,
            counters: incrementAgentCounters(state.counters, { toolCalls: 1 }),
          });
        }
        resolved = resolved.replaceAll('__INLINE_CONTENT__', extracted);
        resolvedFromPlaceholder.add(key);
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

  // Coerce placeholder-resolved string values to arrays when the tool schema
  // declares an array type for that field (e.g. read_files_batch.paths).
  if (resolvedFromPlaceholder.size > 0) {
    const toolSchema = (tool as any).schema;
    if (toolSchema?.shape) {
      for (const key of resolvedFromPlaceholder) {
        if (
          typeof toolParams[key] === 'string' &&
          isZodArrayField(toolSchema.shape[key])
        ) {
          toolParams[key] = coerceToStringArray(toolParams[key] as string);
          logger.debug(
            `Coerced placeholder value for "${key}" to array (${(toolParams[key] as string[]).length} items)`,
          );
        }
      }
    }
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
          code: 'tool_error',
          message: errorResult,
          atPhase: AGENT_PHASES.EXECUTE,
          details,
        },
      ],
    });
  }
}
