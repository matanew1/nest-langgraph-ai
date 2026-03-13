import { Logger } from '@nestjs/common';
import { QdrantClient } from '@qdrant/js-client-rest';
import { env } from '@config/env';

const logger = new Logger('QdrantProvider');

export const qdrantClient = new QdrantClient({ url: env.qdrantUrl });

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
    logger.log(
      `Qdrant connected — collection '${env.qdrantCollection}' ready`,
    );
  }
}
