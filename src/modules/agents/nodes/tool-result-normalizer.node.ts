import type { AgentState } from '../state/agent.state';
import { toToolResult } from '../tools/tool-result';
import { logPhaseEnd, logPhaseStart, startTimer } from '@utils/pretty-log.util';
import { env } from '@config/env';

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

  return {
    phase: 'judge',
    toolResult: result,
    attempts: state.selectedTool
      ? [
          {
            tool: state.selectedTool,
            step: state.currentStep ?? 0,
            params: state.toolParams ?? {},
            result,
          },
        ]
      : [],
  };
}
