/**
 * Centralized configuration for the autonomous agent graph.
 *
 * Keeping these in one place makes routing behavior easier to reason about
 * and avoids scattered "magic numbers" across nodes.
 */
import { env } from '@config/env';

export function getAgentLimits() {
  const turns = env.agentMaxIterations ?? 3;
  const stepRetries = env.agentMaxRetries ?? 3;
  const supervisorFallbacks = env.agentMaxRetbacks ?? turns;

  return {
    /** Max non-progress router cycles (retry/replan/fallback) before fatal. */
    turns,
    /** Max total tool executions before terminating as fatal. */
    toolCalls: turns * 5,
    /** Max replans before terminating as fatal. */
    replans: turns,
    /** Max retries of the same step before terminating as fatal. */
    stepRetries,
    /** Max consecutive supervisor fallbacks before terminating as fatal. */
    supervisorFallbacks,
  };
}

export const AGENT_PLAN_LIMITS = {
  /** Maximum number of steps allowed in a plan. */
  maxSteps: 20,
} as const;
