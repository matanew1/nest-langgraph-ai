import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { RedisModule } from '@redis/redis.module';
import { VectorModule } from '@vector-db/vector.module';

@Module({
  imports: [RedisModule, VectorModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
