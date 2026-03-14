import { Inject, Injectable } from '@nestjs/common';
import type { QdrantClient, Schemas } from '@qdrant/js-client-rest';
import { env } from '@config/env';
import { QDRANT_CLIENT } from './vector.constants';

export interface VectorSearchResult {
  id: string;
  score: number;
  metadata: Record<string, unknown>;
}

@Injectable()
export class VectorService {
  constructor(@Inject(QDRANT_CLIENT) private readonly client: QdrantClient) {}

  async upsert(
    id: string,
    vector: number[],
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.client.upsert(env.qdrantCollection, {
      wait: true,
      points: [{ id, vector, payload: metadata }],
    });
  }

  async search(
    queryVector: number[],
    topK: number,
  ): Promise<VectorSearchResult[]> {
    const results = await this.client.search(env.qdrantCollection, {
      vector: queryVector,
      limit: topK,
      with_payload: true,
    });

    return results.map((hit: Schemas['ScoredPoint']) => ({
      id: String(hit.id),
      score: hit.score,
      metadata: hit.payload ?? {},
    }));
  }
}
