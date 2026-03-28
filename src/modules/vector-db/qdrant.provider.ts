import { Logger } from '@nestjs/common';
import { QdrantClient } from '@qdrant/js-client-rest';
import { env } from '@config/env';

const logger = new Logger('QdrantProvider');

export const qdrantClient = new QdrantClient({
  url: env.qdrantUrl,
  checkCompatibility: env.qdrantCheckCompatibility,
});

let connectPromise: Promise<void> | undefined;

export function getVectorSizeFromCollectionInfo(
  info: unknown,
): number | undefined {
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

export async function connectQdrant(
  client: Pick<
    QdrantClient,
    'getCollections' | 'createCollection' | 'getCollection'
  > = qdrantClient,
): Promise<void> {
  const collections = await client.getCollections();
  const exists = collections.collections.some(
    (c) => c.name === env.qdrantCollection,
  );

  if (!exists) {
    try {
      await client.createCollection(env.qdrantCollection, {
        vectors: { size: env.qdrantVectorSize, distance: 'Cosine' },
      });
      logger.log(
        `Qdrant connected — collection '${env.qdrantCollection}' created (size=${env.qdrantVectorSize})`,
      );
    } catch (err: unknown) {
      // Two concurrent app instances could both see the collection as absent
      // and both attempt to create it. If Qdrant says it already exists, that
      // is fine — another instance created it first. Re-throw everything else.
      const message = err instanceof Error ? err.message : String(err);
      if (!message.toLowerCase().includes('already exists')) throw err;
      logger.log(
        `Qdrant collection '${env.qdrantCollection}' was created by a concurrent process — continuing`,
      );
    }
  } else {
    try {
      const info = await client.getCollection(env.qdrantCollection);
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

export function ensureQdrantReady(
  client: Pick<
    QdrantClient,
    'getCollections' | 'createCollection' | 'getCollection'
  > = qdrantClient,
): Promise<void> {
  if (client !== qdrantClient) {
    return connectQdrant(client);
  }

  if (!connectPromise) {
    connectPromise = connectQdrant(client).catch((error: unknown) => {
      connectPromise = undefined;
      throw error;
    });
  }
  return connectPromise;
}
