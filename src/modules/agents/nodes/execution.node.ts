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
 * Check whether a Zod schema node represents an array type (unwrapping
 * ZodOptional / ZodDefault / ZodNullable wrappers as needed).
 */
function isZodArrayField(fieldSchema: unknown): boolean {
  if (!fieldSchema || typeof fieldSchema !== 'object') return false;
  const typeName = (fieldSchema as any)._def?.typeName as string | undefined;
  if (typeName === 'ZodArray') return true;
  if (
    typeName === 'ZodOptional' ||
    typeName === 'ZodDefault' ||
    typeName === 'ZodNullable'
  ) {
    return isZodArrayField(
      (fieldSchema as any)._def?.innerType ??
        (fieldSchema as any)._def?.type,
    );
  }
  return false;
}

/**
 * Coerce a raw string value to a string array.
 * Priority:
 *   1. JSON array literal
 *   2. File paths extracted from grep output (path:line: content)
 *   3. Non-empty lines
 */
function coerceToStringArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed as string[];
  } catch {
    // not valid JSON, continue
  }
  // Extract unique file paths from grep output lines, e.g. "src/foo.ts:12: ..."
  const paths = new Set<string>();
  for (const line of value.split('\n')) {
    const m = line.match(/^([^\s:][^:]*\.\w+):\d+:/);
    if (m) paths.add(m[1].trim());
  }
  if (paths.size > 0) return Array.from(paths);
  // Fallback: split by newlines
  return value.split('\n').map((l) => l.trim()).filter(Boolean);
}

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
  const resolvedFromPlaceholder = new Set<string>();
  for (const [key, value] of Object.entries(rawParams)) {
    if (typeof value === 'string') {
      let resolved = value;
      if (resolved.includes('__PREVIOUS_RESULT__') && state.toolResultRaw) {
        resolved = resolved.replaceAll('__PREVIOUS_RESULT__', state.toolResultRaw);
        resolvedFromPlaceholder.add(key);
      }
      if (resolved.includes('__INLINE_CONTENT__') && state.input) {
        resolved = resolved.replaceAll('__INLINE_CONTENT__', extractInlineContent(state.input));
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
