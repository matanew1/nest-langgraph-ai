import { Logger } from '@nestjs/common';
import { QdrantClient } from '@qdrant/js-client-rest';
import { env } from '@config/env';

const logger = new Logger('QdrantProvider');

export const qdrantClient = new QdrantClient({ url: env.qdrantUrl });

let connectPromise: Promise<void> | undefined;

function getVectorSizeFromCollectionInfo(info: unknown): number | undefined {
  if (!info || typeof info !== 'object') return undefined;
  const obj = info as Record<string, unknown>;

  const direct = obj['config'];
  if (direct && typeof direct === 'object') {
    const params = (direct as Record<string, unknown>)['params'];
    if (params && typeof params === 'object') {
      const vectors = (params as Record<string, unknown>)['vectors'];
      if (vectors && typeof vectors === 'object') {
        const size = (vectors as Record<string, unknown>)['size'];
        if (typeof size === 'number') return size;
      }
    }
  }

  const result = obj['result'];
  if (result && typeof result === 'object') {
    const cfg = (result as Record<string, unknown>)['config'];
    if (cfg && typeof cfg === 'object') {
      const params = (cfg as Record<string, unknown>)['params'];
      if (params && typeof params === 'object') {
        const vectors = (params as Record<string, unknown>)['vectors'];
        if (vectors && typeof vectors === 'object') {
          const size = (vectors as Record<string, unknown>)['size'];
          if (typeof size === 'number') return size;
        }
      }
    }
  }

  return undefined;
}

export async function connectQdrant(): Promise<void> {
  const collections = await qdrantClient.getCollections();
  const exists = collections.collections.some(
    (c) => c.name === env.qdrantCollection,
  );

  if (!exists) {
    await qdrantClient.createCollection(env.qdrantCollection, {
      vectors: { size: env.qdrantVectorSize, distance: 'Cosine' },
    });
    logger.log(
      `Qdrant connected — collection '${env.qdrantCollection}' created (size=${env.qdrantVectorSize})`,
    );
  } else {
    try {
      const info = await qdrantClient.getCollection(env.qdrantCollection);
      const size = getVectorSizeFromCollectionInfo(info);
      if (typeof size === 'number' && size !== env.qdrantVectorSize) {
        logger.warn(
          `Qdrant collection '${env.qdrantCollection}' vector size mismatch: existing=${size}, env=${env.qdrantVectorSize}. ` +
            `Either recreate the collection or set QDRANT_VECTOR_SIZE=${size}.`,
        );
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`Qdrant collection info check failed: ${message}`);
    }
    logger.log(`Qdrant connected — collection '${env.qdrantCollection}' ready`);
  }
}

export function ensureQdrantReady(): Promise<void> {
  if (!connectPromise) connectPromise = connectQdrant();
  return connectPromise;
}
