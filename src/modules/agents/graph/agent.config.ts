/**
 * Centralized configuration for the autonomous agent graph.
 *
 * Keeping these in one place makes routing behavior easier to reason about
 * and avoids scattered "magic numbers" across nodes.
 */
import { env } from '@config/env';

export function getAgentLimits() {
  return {
    /** Max router turns before terminating as fatal. */
    turns: env.agentMaxIterations,
    /** Max total tool executions before terminating as fatal. */
    toolCalls: env.agentMaxIterations * 5,
    /** Max replans before terminating as fatal. */
    replans: env.agentMaxIterations,
    /** Max retries of the same step before terminating as fatal. */
    stepRetries: env.agentMaxRetries,
    /** Max consecutive supervisor fallbacks before terminating as fatal. */
    supervisorFallbacks: env.agentMaxRetbacks,
  };
}

export const AGENT_PLAN_LIMITS = {
  /** Maximum number of steps allowed in a plan. */
  maxSteps: 20,
} as const;