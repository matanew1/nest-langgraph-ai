import { Logger } from '@nestjs/common';
import {
  upsertVectorMemory,
  searchVectorMemories,
} from '@vector-db/vector-memory.util';
import type { AgentState } from '@state/agent.state';

const logger = new Logger('MemoryPersist');

/** Similarity threshold for dedup — if a near-identical memory exists, update instead of insert. */
const DEDUP_SIMILARITY_THRESHOLD = 0.95;

/**
 * MEMORY_PERSIST node — side-effect only.
 *
 * Upserts the finalAnswer + objective of the completed agent run into the
 * Qdrant vector DB so that future runs can retrieve this result as context.
 * Performs dedup: if a semantically near-identical entry exists (cosine > 0.95),
 * it updates the existing point instead of creating a duplicate.
 * Errors are caught and logged; they never propagate so the graph is unaffected.
 */
export async function memoryPersistNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const objective = state.objective ?? state.input;
  const text = [
    `Objective: ${objective}`,
    `Result: ${state.finalAnswer ?? '(none)'}`,
  ].join('\n');

  try {
    // Dedup check: search for a near-identical objective before inserting
    let existingId: string | undefined;
    try {
      const results = await searchVectorMemories(objective, { topK: 1 });
      if (
        results.length > 0 &&
        results[0].score >= DEDUP_SIMILARITY_THRESHOLD
      ) {
        existingId = results[0].id;
        logger.debug(
          `Memory dedup: found existing entry ${existingId} with score ${results[0].score} — updating`,
        );
      }
    } catch {
      // Dedup check failed — proceed with a new insert
    }

    await upsertVectorMemory({
      text,
      id: existingId,
      metadata: {
        sessionId: state.sessionId,
        type: 'agent_result',
        created_at: new Date().toISOString(),
      },
    });
    logger.debug('Memory persist: upsert complete');
  } catch (err) {
    logger.warn(
      `Memory persist failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return {};
}
