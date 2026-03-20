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

/**
 * Named constants for values that appear in multiple places.
 * Keeps magic numbers out of individual nodes/utilities.
 */
export const AGENT_CONSTANTS = {
  /** Max chars of session memory included in chat prompt. */
  chatMemoryMaxChars: 800,
  /** Max lines of file tree output kept by researcher. */
  researcherTreeMaxLines: 80,
  /** Max bytes for raw tool result stored in state. */
  rawResultMaxBytes: 200_000,
  /** Max tool-call attempts kept in state history. */
  attemptsHistoryCap: 10,
  /** Max error entries kept in state history. */
  errorsHistoryCap: 20,
  /** Max checkpoint history entries per thread in Redis. */
  checkpointHistoryLimit: 25,
  /** Max tools executed concurrently in a parallel group. */
  maxParallelTools: 5,
} as const;
