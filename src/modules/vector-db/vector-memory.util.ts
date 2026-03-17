import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { QdrantClient } from '@qdrant/js-client-rest';
import { env } from '@config/env';
import { EmbeddingService } from './embedding.service';
import {
  ensureQdrantReady,
  getVectorSizeFromCollectionInfo,
  qdrantClient,
} from './qdrant.provider';

const logger = new Logger('VectorMemory');
const embeddings = new EmbeddingService();
const DEFAULT_CONTEXT_TOP_K = 3;
const DEFAULT_SCORE_THRESHOLD = 0.35;
const DEFAULT_TEXT_PREVIEW_CHARS = 240;

type VectorClient = Pick<
  QdrantClient,
  'getCollections' | 'createCollection' | 'getCollection' | 'search' | 'upsert'
>;

export interface VectorCollectionSnapshot {
  name: string;
  status: string;
  pointsCount?: number | null;
  indexedVectorsCount?: number | null;
  segmentsCount?: number | null;
  vectorSize?: number;
  warnings: string[];
}

export interface VectorMemoryHit {
  id: string;
  score: number;
  text?: string;
  payload: Record<string, unknown>;
}

function normalizePayload(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === 'object'
    ? ({ ...(payload as Record<string, unknown>) } as Record<string, unknown>)
    : {};
}

function safeJsonPreview(
  value: unknown,
  maxChars = DEFAULT_TEXT_PREVIEW_CHARS,
): string {
  const text =
    typeof value === 'string' ? value : JSON.stringify(value, null, 2);

  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}...`;
}

function getPayloadText(payload: Record<string, unknown>): string | undefined {
  const candidates = [
    payload.text,
    payload.summary,
    payload.content,
    payload.note,
    payload.message,
    payload.finalAnswer,
    payload.objective,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return safeJsonPreview(candidate.trim());
    }
  }

  const metadata = Object.entries(payload)
    .filter(([key]) => key !== 'text')
    .slice(0, 4);

  if (metadata.length === 0) return undefined;
  return safeJsonPreview(Object.fromEntries(metadata));
}

export async function getVectorCollectionSnapshot(
  client: VectorClient = qdrantClient,
): Promise<VectorCollectionSnapshot> {
  await ensureQdrantReady(client);

  const info = await client.getCollection(env.qdrantCollection);
  return {
    name: env.qdrantCollection,
    status: info.status,
    pointsCount: info.points_count,
    indexedVectorsCount: info.indexed_vectors_count,
    segmentsCount: info.segments_count,
    vectorSize: getVectorSizeFromCollectionInfo(info),
    warnings: (info.warnings ?? []).map((warning) => warning.message),
  };
}

export async function searchVectorMemories(
  query: string,
  options?: {
    topK?: number;
    scoreThreshold?: number;
    client?: VectorClient;
  },
): Promise<VectorMemoryHit[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const client = options?.client ?? qdrantClient;
  await ensureQdrantReady(client);

  const vector = await embeddings.embed(trimmed);
  if (vector.length === 0) return [];
  const topK = options?.topK ?? DEFAULT_CONTEXT_TOP_K;
  const scoreThreshold = options?.scoreThreshold ?? DEFAULT_SCORE_THRESHOLD;
  const results = await client.search(env.qdrantCollection, {
    vector,
    limit: topK,
    with_payload: true,
    score_threshold: scoreThreshold,
  });

  return results.map((result) => {
    const payload = normalizePayload(result.payload);
    return {
      id: String(result.id),
      score: result.score,
      text: getPayloadText(payload),
      payload,
    };
  });
}

export async function upsertVectorMemory(
  args: {
    text: string;
    id?: string;
    metadata?: Record<string, unknown>;
  },
  client: Pick<QdrantClient, 'upsert'> = qdrantClient,
): Promise<{ id: string; vectorSize: number; collection: string }> {
  const vector = await embeddings.embed(args.text);
  if (vector.length === 0) {
    throw new Error('Empty text');
  }

  await ensureQdrantReady();

  const pointId = args.id ?? randomUUID();
  const payload = {
    text: args.text,
    ...(args.metadata ?? {}),
  };

  logger.log(
    `Upserting vector id=${pointId} size=${vector.length} into ${env.qdrantCollection}`,
  );

  await client.upsert(env.qdrantCollection, {
    wait: true,
    points: [{ id: pointId, vector, payload }],
  });

  return {
    id: pointId,
    vectorSize: vector.length,
    collection: env.qdrantCollection,
  };
}

export async function buildVectorResearchContext(
  query: string,
): Promise<string> {
  try {
    const memories = await searchVectorMemories(query);

    if (memories.length === 0) {
      return `## Relevant past memories:\nNone found for "${query}".`;
    }

    const lines = ['## Relevant past memories:'];
    for (const [index, memory] of memories.entries()) {
      lines.push(`${index + 1}. ${memory.text ?? '(no text payload)'}`);
    }

    return lines.join('\n');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`Vector research context unavailable: ${message}`);
    return `## Relevant past memories:\n(unavailable: ${message})`;
  }
}
