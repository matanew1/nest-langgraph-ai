import { env } from '@config/env';

/**
 * Model capability tier — maps task complexity to a Mistral model.
 *
 * FAST     — simple routing decisions, validation, terminal responses
 * BALANCED — chat, research coordination, critic evaluation
 * POWERFUL — multi-step planning, final answer generation
 * CODE     — code-focused tasks (Codestral when available)
 */
export type ModelTier = 'fast' | 'balanced' | 'powerful' | 'code';

/** Phases that benefit most from the powerful model */
const POWERFUL_PHASES = new Set(['plan', 'generate']);

/**
 * Phases that only need a fast, cheap model.
 * Note: execute/execute_parallel run tools directly (no LLM call), and
 * normalize_tool_result/route are lightweight routing steps — all use fast.
 */
const FAST_PHASES = new Set([
  'supervisor',
  'validate_plan',
  'route',
  'fatal_recovery',
  'clarification',
  'research_join',
  'memory_persist',
  'normalize_tool_result',
  'execute',
  'execute_parallel',
  'research',
]);

/**
 * Select the most appropriate Mistral model for a given agent phase.
 * Falls back to 'balanced' for unknown phases (chat, critic, research, etc.).
 */
export function selectModelForPhase(phase: string): string {
  if (POWERFUL_PHASES.has(phase)) return env.mistralModelPowerful;
  if (FAST_PHASES.has(phase)) return env.mistralModelFast;
  // Balanced covers: chat, judge (critic), research_vector, etc.
  return env.mistralModelBalanced;
}

/** Look up a model directly by tier (for use inside node implementations). */
export function selectModelForTier(tier: ModelTier): string {
  switch (tier) {
    case 'fast':
      return env.mistralModelFast;
    case 'powerful':
      return env.mistralModelPowerful;
    case 'code':
      return env.mistralModelCode;
    default:
      return env.mistralModelBalanced;
  }
}
