import { env } from '@config/env';
import type { AgentState } from '../state/agent.state';
import { toolRegistry } from '../tools';

export const JSON_ONLY =
  'CRITICAL: Your entire response must be a single JSON object. Start with { and end with }. No prose, no markdown, no code fences, no explanation outside the JSON.';

export const SELF_REFLECTION =
  'Silently verify before output: (1) starts with {  (2) ends with }  (3) no text outside the JSON  (4) no hallucinated tools.';

export function formatPromptSection(
  value: string | undefined,
  fallback: string,
  maxChars = env.promptMaxSummaryChars,
): string {
  if (!value || !value.trim()) return fallback;
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars)}\n...[truncated]`;
}

export function formatAttempts(state: AgentState): string {
  const all = state.attempts ?? [];
  const recent = all.slice(-env.promptMaxAttempts);
  let displayRecent = recent;
  let trimNote = '';

  let totalPreviewChars = 0;
  for (const attempt of recent) {
    totalPreviewChars +=
      JSON.stringify(attempt.params).length +
      Math.min(attempt.result.preview.length, 200);
  }

  if (totalPreviewChars > env.promptMaxSummaryChars) {
    displayRecent = recent.slice(-3);
    trimNote = `\n[TASK TRIMMED: ${recent.length - 3} earlier attempts to fit context window]`;
  }

  if (displayRecent.length === 0) return '';

  const lines = displayRecent.map(
    (attempt, index) =>
      `${index + 1}. step=${attempt.step + 1} tool="${attempt.tool}" params=${JSON.stringify(attempt.params)} → ${attempt.result.ok ? 'OK' : 'ERROR'}: ${attempt.result.preview.slice(0, 150)}...`,
  );

  return `\nPrevious attempts:${trimNote}\n${lines.join('\n')}`;
}

export function getAvailableTools(state: AgentState): string {
  const excludedNames = new Set(
    (state.attempts ?? [])
      .filter((attempt) => !attempt.result.ok)
      .map((attempt) => attempt.tool),
  );

  return toolRegistry.describeForPrompt({ excludeNames: excludedNames });
}
