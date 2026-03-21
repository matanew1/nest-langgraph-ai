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
      parallelResult: true,
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
      for (const [key, value] of Object.entries(step.input)) {
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

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), env.toolTimeoutMs);
      try {
        const result = (await tool.invoke(toolParams, {
          signal: controller.signal,
        })) as string;
        return {
          step_id: step.step_id,
          tool: step.tool,
          result,
          success: true,
        };
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
    counters: incrementAgentCounters(state.counters, {
      toolCalls: group.length,
    }),
    ...(errors.length > 0 ? { errors } : {}),
  });
}
