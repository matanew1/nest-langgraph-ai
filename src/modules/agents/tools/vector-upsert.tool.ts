import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { upsertVectorMemory } from '@vector-db/vector-memory.util';

export const vectorUpsertTool = tool(
  async ({ text, id, metadata }) => {
    const result = await upsertVectorMemory({ text, id, metadata });

    return JSON.stringify(
      {
        ok: true,
        ...result,
      },
      null,
      2,
    );
  },
  {
    name: 'vector_upsert',
    description:
      'Create an embedding for text and upsert it into Qdrant for later semantic recall',
    schema: z
      .object({
        text: z.string().min(1),
        id: z.string().min(1).optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      })
      .strict(),
  },
);
