/**
 * Centralized configuration for the autonomous agent graph.
 *
 * Keeping these in one place makes routing behavior easier to reason about
 * and avoids scattered "magic numbers" across nodes.
 */
export const AGENT_LIMITS = {
  /** Max router turns before terminating as fatal. */
  turns: 25,
  /** Max total tool executions before terminating as fatal. */
  toolCalls: 50,
  /** Max replans before terminating as fatal. */
  replans: 5,
  /** Max retries of the same step before terminating as fatal. */
  stepRetries: 5,
} as const;

export const AGENT_PLAN_LIMITS = {
  /** Maximum number of steps allowed in a plan. */
  maxSteps: 20,
} as const;

