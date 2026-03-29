import { Provider } from '@nestjs/common';
import { RedisSaver } from './redis-saver';
import { REDIS_CLIENT } from '@redis/redis.constants';
import type { Redis } from 'ioredis';

export const REDIS_SAVER = Symbol('REDIS_SAVER');

export const redisSaverProvider: Provider = {
  provide: RedisSaver,
  useFactory: (redisClient: Redis) => new RedisSaver(redisClient),
  inject: [REDIS_CLIENT],
};
