import type { AgentState } from '../state/agent.state';
import { toToolResult } from '../tools/tool-result';
import { logPhaseEnd, logPhaseStart, startTimer } from '@utils/pretty-log.util';
import { env } from '@config/env';
import { AGENT_PHASES } from '../state/agent-phase';
import { transitionToPhase } from '../state/agent-transition.util';

/**
 * Converts raw tool output (`toolResultRaw`) into a structured ToolResult envelope.
 *
 * This creates a stable contract for the critic and avoids stringly-typed
 * heuristics scattered across the codebase.
 */
export async function toolResultNormalizerNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const elapsed = startTimer();
  const tool = state.selectedTool ?? 'unknown';
  logPhaseStart('TOOL_RESULT_NORMALIZER', `tool="${tool}"`);

  // Handle parallel execution results
  if (state.parallelResult && state.toolResultRaw) {
    try {
      const results: Array<{
        step_id: number;
        tool: string;
        result: string;
        success: boolean;
      }> = JSON.parse(state.toolResultRaw);
      const succeeded = results.filter((r) => r.success).length;
      const failed = results.length - succeeded;
      const summaryLines = results.map(
        (r) =>
          `[Step ${r.step_id} – ${r.tool}] ${r.success ? 'OK' : 'FAILED'}: ${r.result.slice(0, 300)}`,
      );
      const summaryText = [
        `Parallel execution: ${results.length} steps, ${succeeded} succeeded, ${failed} failed.`,
        ...summaryLines,
      ].join('\n');

      const result = toToolResult({
        tool: 'parallel_execution',
        raw: summaryText,
        previewMaxChars: env.criticResultMaxChars,
        rawMaxChars: 200_000,
      });

      logPhaseEnd(
        'TOOL_RESULT_NORMALIZER',
        `PARALLEL (${succeeded}/${results.length})`,
        elapsed(),
      );
      return transitionToPhase(AGENT_PHASES.JUDGE, {
        toolResult: result,
        parallelResult: false,
        attempts: [
          {
            tool: 'parallel_execution',
            step: state.currentStep ?? 0,
            params: {},
            result,
            replanGeneration: state.counters?.replans ?? 0,
          },
        ],
      });
    } catch {
      // fallthrough to normal path if JSON parse fails
    }
  }

  const raw = state.toolResultRaw ?? '';
  const result = toToolResult({
    tool,
    raw,
    previewMaxChars: env.criticResultMaxChars,
    rawMaxChars: 200_000,
  });

  logPhaseEnd(
    'TOOL_RESULT_NORMALIZER',
    result.ok ? `OK (${result.kind})` : 'ERROR',
    elapsed(),
  );

  return transitionToPhase(AGENT_PHASES.JUDGE, {
    toolResult: result,
    parallelResult: false,
    attempts: state.selectedTool
      ? [
          {
            tool: state.selectedTool,
            step: state.currentStep ?? 0,
            params: state.toolParams ?? {},
            result,
            replanGeneration: state.counters?.replans ?? 0,
          },
        ]
      : [],
  });
}
