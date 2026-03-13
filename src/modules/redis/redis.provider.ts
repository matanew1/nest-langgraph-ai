import Redis from 'ioredis';
import { Logger } from '@nestjs/common';
import { env } from '@config/env';

const logger = new Logger('RedisProvider');

export const redis = new Redis({
  host: env.redisHost,
  port: env.redisPort,
  // Don't establish the connection immediately — connect only on first use
  lazyConnect: true,
  // Exponential backoff: 200ms, 400ms, 800ms then give up
  retryStrategy: (times) => {
    if (times > 3) {
      logger.error('Redis max reconnect attempts reached — giving up');
      return null;
    }
    return Math.min(times * 200, 800);
  },
});

redis.on('connect', () => logger.log('Redis connected'));
redis.on('ready', () => logger.log('Redis ready'));
redis.on('error', (err: Error) => logger.error(`Redis error: ${err.message}`));
redis.on('close', () => logger.warn('Redis connection closed'));
redis.on('reconnecting', () => logger.warn('Redis reconnecting…'));
