import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { HealthService } from './health.service';
import type {
  DependencyReportResponse,
  LivenessResponse,
  ReadinessResponse,
} from './health.types';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Readiness check endpoint' })
  @ApiResponse({ status: 200, description: 'Core service readiness' })
  check(): Promise<ReadinessResponse> {
    return this.healthService.getReadiness();
  }

  @Get('live')
  @ApiOperation({ summary: 'Liveness check endpoint' })
  @ApiResponse({ status: 200, description: 'Process liveness' })
  live(): LivenessResponse {
    return this.healthService.getLiveness();
  }

  @Get('ready')
  @ApiOperation({ summary: 'Explicit readiness check endpoint' })
  @ApiResponse({ status: 200, description: 'Core service readiness' })
  ready(): Promise<ReadinessResponse> {
    return this.healthService.getReadiness();
  }

  @Get('dependencies')
  @ApiOperation({ summary: 'Detailed dependency diagnostics endpoint' })
  @ApiResponse({
    status: 200,
    description: 'Required and optional dependencies',
  })
  dependencies(): Promise<DependencyReportResponse> {
    return this.healthService.getDependencyReport();
  }
}
