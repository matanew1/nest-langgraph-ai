import { tool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { env } from '@config/env';
import { ensureQdrantReady, qdrantClient } from '@vector-db/qdrant.provider';
import { EmbeddingService } from '@vector-db/embedding.service';

const logger = new Logger('VectorSearchTool');
const embeddings = new EmbeddingService();

export const vectorSearchTool = tool(
  async ({ query, topK }) => {
    await ensureQdrantReady();

    const vector = await embeddings.embed(query);
    if (vector.length === 0) return JSON.stringify({ ok: false, error: 'Empty query' });

    const k = topK ?? 5;
    logger.log(`Searching topK=${k} in ${env.qdrantCollection}`);

    const results = await qdrantClient.search(env.qdrantCollection, {
      vector,
      limit: k,
      with_payload: true,
    });

    return JSON.stringify(
      {
        ok: true,
        topK: k,
        results: results.map((r) => ({
          id: String(r.id),
          score: r.score,
          metadata: r.payload ?? {},
        })),
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

