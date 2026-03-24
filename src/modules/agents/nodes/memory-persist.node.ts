import { Logger } from '@nestjs/common';
import { upsertVectorMemory } from '@vector-db/vector-memory.util';
import type { AgentState } from '@state/agent.state';

const logger = new Logger('MemoryPersist');

/**
 * MEMORY_PERSIST node — side-effect only.
 *
 * Upserts the finalAnswer + objective of the completed agent run into the
 * Qdrant vector DB so that future runs can retrieve this result as context.
 * Errors are caught and logged; they never propagate so the graph is unaffected.
 */
export async function memoryPersistNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const text = [
    `Objective: ${state.objective ?? state.input}`,
    `Result: ${state.finalAnswer ?? '(none)'}`,
  ].join('\n');

  try {
    await upsertVectorMemory({
      text,
      metadata: { sessionId: state.sessionId, type: 'agent_result' },
    });
    logger.debug('Memory persist: upsert complete');
  } catch (err) {
    logger.warn(
      `Memory persist failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return {};
}
