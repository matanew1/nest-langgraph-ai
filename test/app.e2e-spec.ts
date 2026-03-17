import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { HealthController } from '../src/modules/health/health.controller';
import { REDIS_CLIENT } from '../src/modules/redis/redis.constants';
import { QDRANT_CLIENT } from '../src/modules/vector-db/vector.constants';

jest.mock('@llm/llm.provider', () => ({
  llm: {},
  invokeLlm: jest.fn(),
}));

import { AppModule } from './../src/app.module';
import { HealthService } from '../src/modules/health/health.service';

describe('HealthController (e2e)', () => {
  let app: INestApplication;
  let healthController: HealthController;
  const mockRedisClient = {
    status: 'end',
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn(),
  };
  const mockQdrantClient = {
    getCollections: jest.fn().mockResolvedValue({
      collections: [{ name: 'agent_vectors' }],
    }),
    getCollection: jest.fn().mockResolvedValue({
      config: { params: { vectors: { size: 384 } } },
    }),
    createCollection: jest.fn().mockResolvedValue(undefined),
  };
  const mockHealthService = {
    getReadiness: jest.fn().mockResolvedValue({
      status: 'ok',
      scope: 'readiness',
      details: {
        redis: 'ok',
        qdrant: 'ok',
      },
      timestamp: '2026-03-17T00:00:00.000Z',
    }),
    getLiveness: jest.fn().mockReturnValue({
      status: 'ok',
      scope: 'liveness',
      uptimeSeconds: 1,
      timestamp: '2026-03-17T00:00:00.000Z',
    }),
    getDependencyReport: jest.fn().mockResolvedValue({
      status: 'ok',
      scope: 'dependencies',
      required: {
        redis: 'ok',
        qdrant: 'ok',
      },
      optional: {
        mistral: 'ok',
        tavily: 'ok',
      },
      timestamp: '2026-03-17T00:00:00.000Z',
    }),
  };

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(REDIS_CLIENT)
      .useValue(mockRedisClient)
      .overrideProvider(QDRANT_CLIENT)
      .useValue(mockQdrantClient)
      .overrideProvider(HealthService)
      .useValue(mockHealthService)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    healthController = app.get(HealthController);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await app.close();
  });

  it('/health (GET)', async () => {
    const body = await healthController.check();

    expect(body.status).toBe('ok');
    expect(body.scope).toBe('readiness');
    expect(body.details).toEqual({
      redis: 'ok',
      qdrant: 'ok',
    });
    expect(body.timestamp).toBe('2026-03-17T00:00:00.000Z');
  });
});
