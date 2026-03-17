import { Inject, Injectable, Logger } from '@nestjs/common';
import { env } from '@config/env';
import axios from 'axios';
import type Redis from 'ioredis';
import type { QdrantClient } from '@qdrant/js-client-rest';
import { REDIS_CLIENT } from '@redis/redis.constants';
import { QDRANT_CLIENT } from '@vector-db/vector.constants';
import type {
  DependencyReportResponse,
  DependencyStatus,
  LivenessResponse,
  ReadinessResponse,
} from './health.types';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private optionalDependenciesCache:
    | {
        expiresAt: number;
        value: DependencyReportResponse['optional'];
      }
    | undefined;
  private optionalDependenciesPromise:
    | Promise<DependencyReportResponse['optional']>
    | undefined;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(QDRANT_CLIENT) private readonly qdrantClient: QdrantClient,
  ) {}

  getLiveness(): LivenessResponse {
    return {
      status: 'ok',
      scope: 'liveness',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  async getReadiness(): Promise<ReadinessResponse> {
    const details = await this.getRequiredDependencyStatuses();
    const status =
      Object.values(details).every((value) => value === 'ok') ? 'ok' : 'unhealthy';

    return {
      status,
      scope: 'readiness',
      details,
      timestamp: new Date().toISOString(),
    };
  }

  async getDependencyReport(): Promise<DependencyReportResponse> {
    const [required, optional] = await Promise.all([
      this.getRequiredDependencyStatuses(),
      this.getOptionalDependencyStatuses(),
    ]);

    const requiredHealthy = Object.values(required).every(
      (value) => value === 'ok',
    );
    const optionalHealthy = Object.values(optional).every(
      (value) => value === 'ok',
    );

    return {
      status: !requiredHealthy
        ? 'unhealthy'
        : optionalHealthy
          ? 'ok'
          : 'degraded',
      scope: 'dependencies',
      required,
      optional,
      timestamp: new Date().toISOString(),
    };
  }

  async checkRedis(): Promise<DependencyStatus> {
    return this.runDependencyCheck('Redis', async () => {
      await this.redis.ping();
      return true;
    });
  }

  async checkQdrant(): Promise<DependencyStatus> {
    return this.runDependencyCheck('Qdrant', async () => {
      const collections = await this.qdrantClient.getCollections();
      return Boolean(collections);
    });
  }

  async checkMistral(): Promise<DependencyStatus> {
    return this.runDependencyCheck('Mistral', async () => {
      const response = await axios.get('https://api.mistral.ai/v1/models', {
        headers: { Authorization: `Bearer ${env.mistralKey}` },
        timeout: env.healthExternalCheckTimeoutMs,
      });
      return response.status === 200;
    });
  }

  async checkTavily(): Promise<DependencyStatus> {
    return this.runDependencyCheck('Tavily', async () => {
      const response = await axios.post(
        'https://api.tavily.com/search',
        { query: 'health check', api_key: env.tavilyKey },
        { timeout: env.healthExternalCheckTimeoutMs },
      );
      return response.status === 200;
    });
  }

  private async getRequiredDependencyStatuses(): Promise<
    ReadinessResponse['details']
  > {
    const [redis, qdrant] = await Promise.all([
      this.checkRedis(),
      this.checkQdrant(),
    ]);

    return { redis, qdrant };
  }

  private async getOptionalDependencyStatuses(): Promise<
    DependencyReportResponse['optional']
  > {
    const now = Date.now();
    if (this.optionalDependenciesCache && this.optionalDependenciesCache.expiresAt > now) {
      return this.optionalDependenciesCache.value;
    }

    if (!this.optionalDependenciesPromise) {
      this.optionalDependenciesPromise = this.refreshOptionalDependencyStatuses();
    }

    return this.optionalDependenciesPromise;
  }

  private async refreshOptionalDependencyStatuses(): Promise<
    DependencyReportResponse['optional']
  > {
    try {
      const [mistral, tavily] = await Promise.all([
        this.checkMistral(),
        this.checkTavily(),
      ]);
      const value = { mistral, tavily };

      this.optionalDependenciesCache = {
        value,
        expiresAt: Date.now() + env.healthExternalCacheTtlMs,
      };

      return value;
    } finally {
      this.optionalDependenciesPromise = undefined;
    }
  }

  private async runDependencyCheck(
    label: string,
    check: () => Promise<boolean>,
  ): Promise<DependencyStatus> {
    try {
      return (await check()) ? 'ok' : 'error';
    } catch (error) {
      this.logger.warn(`${label} health check failed: ${error}`);
      return 'unavailable';
    }
  }
}
