import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { VectorService } from './vector.service';
import { EmbeddingService } from './embedding.service';
import { qdrantClient, connectQdrant } from './qdrant.provider';
import { QDRANT_CLIENT } from './vector.constants';

export { QDRANT_CLIENT } from './vector.constants';

@Module({
  providers: [
    { provide: QDRANT_CLIENT, useValue: qdrantClient },
    VectorService,
    EmbeddingService,
  ],
  exports: [QDRANT_CLIENT, VectorService, EmbeddingService],
})
export class VectorModule implements OnModuleInit {
  private readonly logger = new Logger(VectorModule.name);

  async onModuleInit() {
    try {
      await connectQdrant();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Qdrant connection failed: ${message}`);
    }
  }
}
