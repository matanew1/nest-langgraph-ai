import { Inject, Logger, Module, OnModuleInit } from '@nestjs/common';
import type { QdrantClient } from '@qdrant/js-client-rest';
import { EmbeddingService } from './embedding.service';
import { qdrantClient, connectQdrant } from './qdrant.provider';
import { QDRANT_CLIENT } from './vector.constants';

export { QDRANT_CLIENT } from './vector.constants';

@Module({
  providers: [
    { provide: QDRANT_CLIENT, useValue: qdrantClient },
    EmbeddingService,
  ],
  exports: [QDRANT_CLIENT, EmbeddingService],
})
export class VectorModule implements OnModuleInit {
  private readonly logger = new Logger(VectorModule.name);

  constructor(
    @Inject(QDRANT_CLIENT) private readonly qdrantClient: QdrantClient,
  ) {}

  async onModuleInit() {
    try {
      await connectQdrant(this.qdrantClient);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Qdrant connection failed: ${message}`);
    }
  }
}
