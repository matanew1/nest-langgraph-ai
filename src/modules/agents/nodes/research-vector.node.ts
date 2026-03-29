import { Logger } from '@nestjs/common';
import { logPhaseStart, logPhaseEnd, startTimer } from '@utils/pretty-log.util';
import { withTimeout } from '@utils/timeout.util';
import { AGENT_PHASES } from '@state/agent-phase';
import { buildVectorResearchContext } from '@vector-db/vector-memory.util';
import { env } from '@config/env';
import type { AgentState, AgentError } from '@state/agent.state';

const logger = new Logger('ResearchVector');

/**
 * RESEARCH_VECTOR node — gathers vector/session memory context for the planner.
 *
 * Collects:
 *  1. Vector search results matching the current objective
 *  2. Session memory if present in state
 *
 * Writes `memoryContext` and `vectorMemoryIds` — does NOT set phase or write projectContext.
 */
export async function researchVectorNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const elapsed = startTimer();

  logPhaseStart('RESEARCH_VECTOR', 'gathering vector and session memory');

  const objective = state.objective ?? state.input;
  const memorySections: string[] = [];

  if (state.sessionMemory) {
    memorySections.push(`## Session memory\n${state.sessionMemory}`);
  }

  // Vector search: retrieve past attempts that semantically match the current objective.
  // This gives the planner awareness of what has been tried before, avoiding redundant plans.
  let vectorContext: string;
  let vectorIds: string[];
  try {
    const result = await withTimeout(
      buildVectorResearchContext(objective),
      env.toolTimeoutMs,
      'vector_search',
    );
    vectorContext = result.text;
    vectorIds = result.ids;
  } catch (e) {
    logger.warn(
      `Vector research failed: ${e instanceof Error ? e.message : e}`,
    );
    vectorContext = '## Vector memory\n(unavailable: timed out)';
    vectorIds = [];
  }
  memorySections.push(vectorContext);

  // Track vector search failures as non-fatal warnings in state errors.
  const vectorWarnings: AgentError[] = [];
  if (vectorContext.includes('(unavailable:')) {
    logger.warn('Vector memory search was unavailable — continuing without it');
    vectorWarnings.push({
      code: 'tool_error',
      message: 'Vector memory search was unavailable during research',
      atPhase: AGENT_PHASES.RESEARCH,
    });
  }

  const memoryContext = memorySections.join('\n\n');

  logPhaseEnd(
    'RESEARCH_VECTOR',
    `memory=${memorySections.length} sections, vectorIds=${vectorIds.length}`,
    elapsed(),
  );

  return {
    memoryContext,
    vectorMemoryIds: vectorIds,
    ...(vectorWarnings.length > 0 ? { errors: vectorWarnings } : {}),
  };
}
