import { Module } from '@nestjs/common';
import { AgentsService } from './agents.service';
import { AgentsController } from './agents.controller';
import { RedisModule } from '@redis/redis.module';
import { redisSaverProvider } from './utils/redis-saver.provider';
import { SessionMemoryService } from './services/session-memory.service';
import { PlanReviewService } from './services/plan-review.service';
import { SessionService } from './services/session.service';
import { FeedbackService } from './services/feedback.service';

@Module({
  imports: [RedisModule],
  providers: [
    redisSaverProvider,
    SessionMemoryService,
    PlanReviewService,
    SessionService,
    FeedbackService,
    AgentsService,
  ],
  controllers: [AgentsController],
  exports: [AgentsService],
})
export class AgentsModule {}
