import Redis from 'ioredis';
import { Logger } from '@nestjs/common';
import { env } from '@config/env';

const logger = new Logger('RedisProvider');

export const redis = new Redis({
  host: env.redisHost,
  port: env.redisPort,
  // Don't establish the connection immediately — connect only on first use
  lazyConnect: true,
  // Exponential backoff: 500ms → 1s → 2s → ... capped at 15s, retries indefinitely.
  // Previous strategy gave up after 3 attempts, permanently killing the connection.
  retryStrategy: (times) => {
    const delay = Math.min(times * 500, 15_000);
    if (times % 10 === 0) {
      logger.warn(
        `Redis reconnect attempt #${times} — next retry in ${delay}ms`,
      );
    }
    return delay;
  },
  maxRetriesPerRequest: 3,
});

redis.on('connect', () => logger.log('Redis connected'));
redis.on('ready', () => logger.log('Redis ready'));
redis.on('error', (err: Error) => {
  const message = err.message || 'Unknown Redis error';
  logger.error(`Redis error (${env.redisHost}:${env.redisPort}): ${message}`);
});
redis.on('close', () => logger.warn('Redis connection closed'));
redis.on('reconnecting', () => logger.warn('Redis reconnecting…'));
