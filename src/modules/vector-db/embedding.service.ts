import { Injectable } from '@nestjs/common';

@Injectable()
export class EmbeddingService {
  /**
   * Convert text into a numeric embedding vector.
   * TODO: integrate with an embedding model (e.g. Groq, OpenAI, HuggingFace).
   */
  async embed(_text: string): Promise<number[]> {
    throw new Error('EmbeddingService.embed() not yet implemented');
  }

  /**
   * Compute cosine similarity between two vectors.
   * Returns a value in [-1, 1]; higher means more similar.
   */
  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
    const dot = a.reduce((sum, ai, i) => sum + ai * b[i], 0);
    const magA = Math.sqrt(a.reduce((sum, ai) => sum + ai * ai, 0));
    const magB = Math.sqrt(b.reduce((sum, bi) => sum + bi * bi, 0));
    return magA && magB ? dot / (magA * magB) : 0;
  }
}
