import { Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { upsertVectorMemory } from '@vector-db/vector-memory.util';
import type { AgentState } from '@state/agent.state';

const logger = new Logger('MemoryPersist');

/**
 * MEMORY_PERSIST node — side-effect only.
 *
 * Upserts the finalAnswer + objective of the completed agent run into the
 * Qdrant vector DB so that future runs can retrieve this result as context.
 * Uses a deterministic point id derived from objective + final answer so exact
 * repeats update in place while distinct outcomes remain separate memories.
 * Errors are caught and logged; they never propagate so the graph is unaffected.
 */
export async function memoryPersistNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const objective = (state.objective ?? state.input).trim();
  const finalAnswer = state.finalAnswer?.trim();
  if (!objective || !finalAnswer) {
    return {};
  }

  const text = [
    `Objective: ${objective}`,
    `Result: ${finalAnswer}`,
  ].join('\n');
  const stablePointId = createHash('sha256')
    .update(JSON.stringify({ objective, finalAnswer }))
    .digest('hex');

  try {
    await upsertVectorMemory({
      text,
      id: stablePointId,
      metadata: {
        sessionId: state.sessionId,
        type: 'agent_result',
        stored_at: new Date().toISOString(),
      },
    });
    logger.debug(`Memory persist: upsert complete (${stablePointId})`);
  } catch (err) {
    logger.warn(
      `Memory persist failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return {};
}
