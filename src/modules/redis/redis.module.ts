import { Global, Module, OnModuleInit } from '@nestjs/common';
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
  async onModuleInit() {
    await redis.connect();
  }
}
