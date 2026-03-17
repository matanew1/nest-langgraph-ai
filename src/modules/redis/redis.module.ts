import { Global, Logger, Module, OnModuleInit } from '@nestjs/common';
import { redis } from './redis.provider';
import { RedisService } from './redis.service';
import { REDIS_CLIENT } from './redis.constants';

export { REDIS_CLIENT } from './redis.constants';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useValue: redis,
    },
    RedisService,
  ],
  exports: [REDIS_CLIENT, RedisService],
})
export class RedisModule implements OnModuleInit {
  private readonly logger = new Logger(RedisModule.name);

  async onModuleInit() {
    if (['connect', 'connecting', 'ready'].includes(redis.status)) {
      return;
    }

    try {
      await redis.connect();
    } catch (err: unknown) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'Connection attempt failed';
      this.logger.error(`Redis connection failed at startup: ${message}`);
    }
  }
}
