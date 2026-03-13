import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { redis } from '@redis/redis.provider';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Health check endpoint' })
  @ApiResponse({ status: 200, description: 'Service is healthy' })
  async check(): Promise<{ status: string; redis: string; timestamp: string }> {
    let redisStatus = 'ok';
    try {
      await redis.ping();
    } catch {
      redisStatus = 'unavailable';
    }

    return {
      status: 'ok',
      redis: redisStatus,
      timestamp: new Date().toISOString(),
    };
  }
}
