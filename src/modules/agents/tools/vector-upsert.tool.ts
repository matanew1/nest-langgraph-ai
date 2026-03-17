import { tool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { env } from '@config/env';
import { ensureQdrantReady, qdrantClient } from '@vector-db/qdrant.provider';
import { EmbeddingService } from '@vector-db/embedding.service';
import { randomUUID } from 'crypto';

const logger = new Logger('VectorUpsertTool');
const embeddings = new EmbeddingService();

export const vectorUpsertTool = tool(
  async ({ text, id, metadata }) => {
    await ensureQdrantReady();

    const vector = await embeddings.embed(text);
    if (vector.length === 0) return JSON.stringify({ ok: false, error: 'Empty text' });

    const pointId = id ?? randomUUID();
    const payload = metadata ?? { text };

    logger.log(
      `Upserting vector id=${pointId} size=${vector.length} into ${env.qdrantCollection}`,
    );

    await qdrantClient.upsert(env.qdrantCollection, {
      wait: true,
      points: [{ id: pointId, vector, payload }],
    });

    return JSON.stringify(
      {
        ok: true,
        id: pointId,
        vectorSize: vector.length,
        collection: env.qdrantCollection,
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

