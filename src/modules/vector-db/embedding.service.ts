import { Injectable } from '@nestjs/common';
import { env } from '@config/env';

type FeatureExtractionPipeline = ((
  input: string | string[],
  options?: Record<string, unknown>,
) => Promise<{ data: Float32Array | number[]; dims?: number[] }>) & {
  // allow extra properties without using `any`
  [k: string]: unknown;
};

let pipelinePromise: Promise<FeatureExtractionPipeline> | undefined;

async function getEmbeddingPipeline(): Promise<FeatureExtractionPipeline> {
  if (!pipelinePromise) {
    pipelinePromise = import('@xenova/transformers').then(async (m) => {
      const pipeline = (m as unknown as { pipeline: unknown }).pipeline;
      if (typeof pipeline !== 'function') {
        throw new Error(
          'Failed to load embedding pipeline from @xenova/transformers',
        );
      }
      // NOTE: This model is free and runs locally (no API key).
      return (
        pipeline as (
          task: string,
          model: string,
        ) => Promise<FeatureExtractionPipeline>
      )('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    });
  }
  return pipelinePromise;
}

/**
 * Eagerly load the embedding model so the first vector operation
 * does not pay the cold-start penalty.
 */
export async function warmUpEmbeddings(): Promise<void> {
  await getEmbeddingPipeline();
}

@Injectable()
export class EmbeddingService {
  /**
   * Convert text into a numeric embedding vector.
   */
  async embed(text: string): Promise<number[]> {
    const input = text.trim();
    if (!input) return [];

    const extractor = await getEmbeddingPipeline();
    const output = await extractor(input, { pooling: 'mean', normalize: true });

    const vector = Array.from(output.data);
    if (env.qdrantVectorSize && vector.length !== env.qdrantVectorSize) {
      throw new Error(
        `Embedding dimension (${vector.length}) does not match QDRANT_VECTOR_SIZE (${env.qdrantVectorSize}). ` +
          `Set QDRANT_VECTOR_SIZE=${vector.length} (recommended for Xenova/all-MiniLM-L6-v2).`,
      );
    }

    return vector;
  }
}
