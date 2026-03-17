import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { searchVectorMemories } from '@vector-db/vector-memory.util';

export const vectorSearchTool = tool(
  async ({ query, topK }) => {
    const effectiveTopK = topK ?? 5;
    const results = await searchVectorMemories(query, {
      topK: effectiveTopK,
    });

    return JSON.stringify(
      {
        ok: true,
        topK: effectiveTopK,
        results,
      },
      null,
      2,
    );
  },
  {
    name: 'vector_search',
    description: 'Search Qdrant using an embedding for semantic recall',
    schema: z
      .object({
        query: z.string().min(1),
        topK: z.number().int().min(1).max(50).optional(),
      })
      .strict(),
  },
);
