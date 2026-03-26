import {
  Global,
  Inject,
  Logger,
  Module,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import type Redis from 'ioredis';
import { redis } from './redis.provider';
import { REDIS_CLIENT } from './redis.constants';

export { REDIS_CLIENT } from './redis.constants';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useValue: redis,
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RedisModule.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redisClient: Redis) {}

  async onModuleInit() {
    if (['connect', 'connecting', 'ready'].includes(this.redisClient.status)) {
      return;
    }

    try {
      await this.redisClient.connect();
    } catch (err: unknown) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'Connection attempt failed';
      this.logger.error(`Redis connection failed at startup: ${message}`);
    }
  }

  onApplicationShutdown(signal?: string) {
    this.logger.log(
      `Shutting down Redis connection (signal: ${signal ?? 'none'})`,
    );
    if (this.redisClient.status === 'end') {
      return;
    }

    this.redisClient.disconnect(false);
    this.logger.log('Redis disconnected');
  }
}
