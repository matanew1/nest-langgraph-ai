import { Injectable, BadRequestException, Logger, Inject } from '@nestjs/common';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '@redis/redis.constants';
import { env } from '@config/env';
import { updatePointSalience } from '../../vector-db/vector-memory.util';
import { RedisSaver } from '../utils/redis-saver';
import type {
  SubmitFeedbackDto,
  FeedbackStatsResponseDto,
} from '../agents.dto';

/** Safe session ID pattern. */
const SESSION_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function assertValidSessionId(sessionId: string): void {
  if (!SESSION_ID_RE.test(sessionId)) {
    throw new BadRequestException(
      `Invalid sessionId "${sessionId}". Must be 1–64 alphanumeric/hyphen/underscore characters.`,
    );
  }
}

@Injectable()
export class FeedbackService {
  private readonly logger = new Logger(FeedbackService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redisClient: Redis,
    private readonly checkpointer: RedisSaver,
  ) {}

  async submitFeedback(
    sessionId: string,
    dto: SubmitFeedbackDto,
  ): Promise<FeedbackStatsResponseDto> {
    assertValidSessionId(sessionId);
    const idempotencyKey = `agent:feedback:${sessionId}`;

    const existing = await this.redisClient.get(`${idempotencyKey}:stats`);
    if (existing) {
      return JSON.parse(existing) as FeedbackStatsResponseDto;
    }

    const vectorIds = await this.checkpointer.getVectorMemoryIds(sessionId);
    const targetSalience = dto.rating === 'positive' ? 0.9 : 0.2;
    let pointsUpdated = 0;

    for (const id of vectorIds) {
      try {
        await updatePointSalience(id, targetSalience);
        pointsUpdated++;
      } catch (err) {
        this.logger.warn(`Failed to update salience for point ${id}: ${err}`);
      }
    }

    const stats: FeedbackStatsResponseDto = {
      sessionId,
      rating: dto.rating,
      submittedAt: new Date().toISOString(),
      pointsUpdated,
    };

    const ttl = env.sessionTtlSeconds;
    if (ttl > 0) {
      await this.redisClient.set(
        `${idempotencyKey}:stats`,
        JSON.stringify(stats),
        'EX',
        ttl,
      );
    } else {
      await this.redisClient.set(
        `${idempotencyKey}:stats`,
        JSON.stringify(stats),
      );
    }

    return stats;
  }

  async getFeedbackStats(sessionId: string): Promise<FeedbackStatsResponseDto> {
    assertValidSessionId(sessionId);
    const stats = await this.redisClient.get(
      `agent:feedback:${sessionId}:stats`,
    );
    if (!stats) {
      return { sessionId, rating: null, submittedAt: null, pointsUpdated: 0 };
    }
    return JSON.parse(stats) as FeedbackStatsResponseDto;
  }
}
