/**
 * Parallel Execution Node
 *
 * Executes a contiguous group of plan steps that share the same `parallel_group` id
 * concurrently using `Promise.allSettled`. Each tool invocation is guarded by an
 * AbortController timeout and a `timedOut` flag to handle race conditions at the
 * timeout boundary. Results are serialised as JSON and forwarded to the
 * `normalize_tool_result` phase.
 */
import { Logger } from '@nestjs/common';
import type { AgentState, AgentError, PlanStep } from '../state/agent.state';
import { toolRegistry } from '../tools/index';
import { env } from '@config/env';
import { logPhaseStart, logPhaseEnd, startTimer } from '@utils/pretty-log.util';
import { incrementAgentCounters } from '../state/agent-state.helpers';
import { AGENT_PHASES } from '../state/agent-phase';
import { transitionToPhase } from '../state/agent-transition.util';
import { AGENT_CONSTANTS } from '../graph/agent.config';

const logger = new Logger('ParallelExecutor');

/** Unwrap ZodOptional/ZodDefault/ZodNullable to detect ZodArray fields. */
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

/** Coerce a raw string to a string array (JSON → grep paths → newline split). */
function coerceToStringArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed as string[];
  } catch {
    // not valid JSON, continue
  }
  const paths = new Set<string>();
  for (const line of value.split('\n')) {
    const m = line.match(/^([^\s:][^:]*\.\w+):\d+:/);
    if (m) paths.add(m[1].trim());
  }
  if (paths.size > 0) return Array.from(paths);
  return value.split('\n').map((l) => l.trim()).filter(Boolean);
}

export interface ParallelStepResult {
  step_id: number;
  tool: string;
  result: string;
  success: boolean;
}

export async function parallelExecutionNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const elapsed = startTimer();

  const plan: PlanStep[] = state.plan ?? [];
  const startIndex = state.currentStep ?? 0;
  const firstStep = plan[startIndex];

  if (!firstStep) {
    logPhaseEnd('PARALLEL_EXECUTOR', 'No step at currentStep index', elapsed());
    return transitionToPhase(AGENT_PHASES.NORMALIZE_TOOL_RESULT, {
      toolResultRaw: JSON.stringify([]),
      parallelResult: false,
      counters: incrementAgentCounters(state.counters, { toolCalls: 0 }),
    });
  }

  const groupId = firstStep.parallel_group;

  // Collect contiguous steps with the same parallel_group, capped at maxParallelTools
  const group: PlanStep[] = [];
  for (
    let i = startIndex;
    i < plan.length && group.length < AGENT_CONSTANTS.maxParallelTools;
    i++
  ) {
    const step = plan[i];
    if (step.parallel_group !== groupId) break;
    group.push(step);
  }

  logPhaseStart(
    'PARALLEL_EXECUTOR',
    `group=${groupId} | ${group.length} steps: [${group.map((s) => s.tool).join(', ')}]`,
  );

  // Execute all steps in parallel
  const settled = await Promise.allSettled(
    group.map(async (step): Promise<ParallelStepResult> => {
      // Resolve __PREVIOUS_RESULT__ placeholders
      const toolParams: Record<string, unknown> = {};
      const resolvedFromPlaceholder = new Set<string>();
      for (const [key, value] of Object.entries(step.input)) {
        if (
          typeof value === 'string' &&
          value.includes('__PREVIOUS_RESULT__')
        ) {
          if (!state.toolResultRaw) {
            throw new Error(
              `Step ${step.step_id} references __PREVIOUS_RESULT__ but no prior result exists.`,
            );
          }
          toolParams[key] = value.replaceAll(
            '__PREVIOUS_RESULT__',
            state.toolResultRaw,
          );
          resolvedFromPlaceholder.add(key);
        } else {
          toolParams[key] = value;
        }
      }

      const tool = toolRegistry.get(step.tool);
      if (!tool) {
        const msg = `Unknown tool "${step.tool}". Available: ${toolRegistry.getNames().join(', ')}`;
        logger.warn(msg);
        return {
          step_id: step.step_id,
          tool: step.tool,
          result: `ERROR: ${msg}`,
          success: false,
        };
      }

      // Coerce placeholder-resolved string values to arrays when the tool
      // schema declares an array type for that field (e.g. read_files_batch.paths).
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

      let timedOut = false;
      const controller = new AbortController();
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, env.toolTimeoutMs);

      let rawResult: string;
      try {
        rawResult = (await tool.invoke(toolParams, {
          signal: controller.signal,
        })) as string;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const errorMsg = `Tool "${step.tool}" failed: ${message}`;
        logger.error(errorMsg);
        return {
          step_id: step.step_id,
          tool: step.tool,
          result: `ERROR: ${errorMsg}`,
          success: false,
        };
      } finally {
        clearTimeout(timer);
      }

      if (timedOut) {
        return {
          step_id: step.step_id,
          tool: step.tool,
          result: `ERROR: Tool "${step.tool}" timed out after ${env.toolTimeoutMs}ms`,
          success: false,
        };
      }
      return {
        step_id: step.step_id,
        tool: step.tool,
        result: rawResult,
        success: true,
      };
    }),
  );

  // Collect results (Promise.allSettled guarantees all resolve — inner try/catch ensures fulfilled always)
  const results: ParallelStepResult[] = settled.map((outcome, idx) => {
    if (outcome.status === 'fulfilled') {
      return outcome.value;
    }
    // This path is only reached if our inner function itself throws (shouldn't happen, but guard anyway)
    const step = group[idx];
    const message =
      outcome.reason instanceof Error
        ? outcome.reason.message
        : String(outcome.reason);
    return {
      step_id: step.step_id,
      tool: step.tool,
      result: `ERROR: Tool "${step.tool}" failed: ${message}`,
      success: false,
    };
  });

  // Collect AgentErrors for failed steps
  const errors: AgentError[] = results
    .filter((r) => !r.success)
    .map((r) => ({
      code: 'tool_error' as const,
      message: r.result,
      atPhase: AGENT_PHASES.EXECUTE_PARALLEL,
    }));

  const toolResultRaw = JSON.stringify(results);
  logPhaseEnd(
    'PARALLEL_EXECUTOR',
    `${results.filter((r) => r.success).length}/${results.length} succeeded`,
    elapsed(),
  );

  return transitionToPhase(AGENT_PHASES.NORMALIZE_TOOL_RESULT, {
    toolResultRaw,
    parallelResult: true,
    currentStep: startIndex + group.length - 1,
    counters: incrementAgentCounters(state.counters, {
      toolCalls: group.length,
    }),
    errors,
  });
}
