import { Logger } from '@nestjs/common';
import { env } from '@config/env';
import {
  logPhaseStart,
  logPhaseEnd,
  startTimer,
} from '@utils/pretty-log.util';
import { AGENT_CONSTANTS } from './graph/agent.config';
import { AGENT_PHASES } from './state/agent-phase';
import { incrementAgentCounters } from './state/agent-state.helpers';
import { transitionToPhase } from './state/agent-transition.util';
import { PlanStep, AgentState } from './state/agent.state';
import { toolRegistry } from './tools';

const logger = new Logger('ParallelExecutor');

interface ParallelResult {
  step_id: number;
  tool: string;
  status: 'fulfilled' | 'rejected';
  result: string;
}

async function executeToolWithTimeout(
  step: PlanStep,
  toolResultRaw: string | undefined,
): Promise<string> {
  const tool = toolRegistry.get(step.tool);
  if (!tool) {
    throw new Error(
      `Unknown tool "${step.tool}". Available: ${toolRegistry.getNames().join(', ')}`,
    );
  }

  // Substitute __PREVIOUS_RESULT__ placeholders
  const params: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(step.input)) {
    if (
      typeof value === 'string' &&
      value.includes('__PREVIOUS_RESULT__') &&
      toolResultRaw
    ) {
      params[key] = value.replaceAll('__PREVIOUS_RESULT__', toolResultRaw);
    } else {
      params[key] = value;
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.toolTimeoutMs);
  try {
    const result = (await tool.invoke(params, {
      signal: controller.signal,
    })) as string;
    return result;
  } finally {
    clearTimeout(timer);
  }
}

export async function parallelExecutionNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const elapsed = startTimer();
  const plan = state.plan ?? [];
  const currentStep = state.currentStep ?? 0;
  const currentGroup = plan[currentStep]?.parallel_group;

  // Collect all steps in the current parallel group
  const groupSteps: PlanStep[] = [];
  for (let i = currentStep; i < plan.length; i++) {
    if (plan[i].parallel_group === currentGroup) {
      groupSteps.push(plan[i]);
    } else {
      break; // Groups must be contiguous
    }
  }

  // Cap at maxParallelTools
  const maxTools = AGENT_CONSTANTS.maxParallelTools;
  const stepsToRun = groupSteps.slice(0, maxTools);

  logPhaseStart(
    'PARALLEL_EXECUTOR',
    `group=${currentGroup} steps=${stepsToRun.length}`,
  );

  const results = await Promise.allSettled(
    stepsToRun.map((step) =>
      executeToolWithTimeout(step, state.toolResultRaw),
    ),
  );

  const parallelResults: ParallelResult[] = results.map((result, i) => ({
    step_id: stepsToRun[i].step_id,
    tool: stepsToRun[i].tool,
    status: result.status,
    result:
      result.status === 'fulfilled'
        ? result.value
        : result.status === 'rejected'
          ? `ERROR: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`
          : '',
  }));

  const nextStepIndex = currentStep + stepsToRun.length;

  logPhaseEnd(
    'PARALLEL_EXECUTOR',
    `${parallelResults.filter((r) => r.status === 'fulfilled').length}/${stepsToRun.length} succeeded`,
    elapsed(),
  );

  // Record errors for failed tools
  const errors = parallelResults
    .filter((r) => r.status === 'rejected')
    .map((r) => ({
      code: 'tool_error' as const,
      message: `Parallel tool "${r.tool}" (step ${r.step_id}) failed: ${r.result}`,
      atPhase: AGENT_PHASES.EXECUTE_PARALLEL,
    }));

  return transitionToPhase(AGENT_PHASES.NORMALIZE_TOOL_RESULT, {
    toolResultRaw: JSON.stringify(parallelResults),
    parallelResult: true,
    currentStep: nextStepIndex - 1, // normalizer/critic will see this as current
    selectedTool: stepsToRun.map((s) => s.tool).join('+'),
    counters: incrementAgentCounters(state.counters, {
      toolCalls: stepsToRun.length,
    }),
    ...(errors.length > 0 ? { errors } : {}),
  });
}