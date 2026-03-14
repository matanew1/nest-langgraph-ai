import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { HealthModule } from './modules/health/health.module';
import { LlmModule } from './modules/llm/llm.module';
import { RedisModule } from './modules/redis/redis.module';
import { AgentsModule } from './modules/agents/agents.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 60 }],
    }),

    LlmModule,
    RedisModule,
    AgentsModule,
    HealthModule,
  ],
})
export class AppModule {}
