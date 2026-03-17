import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { HealthService } from './health.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}
  @Get()
  @ApiOperation({ summary: 'Health check endpoint' })
  @ApiResponse({ status: 200, description: 'Service is healthy' })
  async check(): Promise<any> {
    const results = await Promise.allSettled([
      this.healthService.checkRedis(),
      this.healthService.checkQdrant(),
      this.healthService.checkMistral(),
      this.healthService.checkTavily(),
    ]);

    const [redisStatus, qdrantStatus, mistralStatus, tavilyStatus] =
      results.map((res) => (res.status === 'fulfilled' ? res.value : 'error'));

    const isHealthy = [redisStatus, qdrantStatus].every((s) => s === 'ok');

    return {
      status: isHealthy ? 'ok' : 'unhealthy',
      details: {
        redis: redisStatus,
        qdrant: qdrantStatus,
        mistral: mistralStatus,
        tavily: tavilyStatus,
      },
      timestamp: new Date().toISOString(),
    };
  }
}
