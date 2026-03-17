import { Test, TestingModule } from '@nestjs/testing';
import axios from 'axios';
import { HealthService } from './health.service';
import { REDIS_CLIENT } from '@redis/redis.constants';
import { QDRANT_CLIENT } from '@vector-db/vector.constants';

jest.mock('@config/env', () => ({
  env: {
    mistralKey: 'mistral-key',
    tavilyKey: 'tavily-key',
    healthExternalCheckTimeoutMs: 2_000,
    healthExternalCacheTtlMs: 60_000,
  },
}));

jest.mock('axios');

const mockRedis = {
  ping: jest.fn(),
};

const mockQdrant = {
  getCollections: jest.fn(),
};

describe('HealthService', () => {
  let service: HealthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        { provide: REDIS_CLIENT, useValue: mockRedis },
        { provide: QDRANT_CLIENT, useValue: mockQdrant },
      ],
    }).compile();

    service = module.get(HealthService);
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns liveness without touching dependencies', () => {
    const result = service.getLiveness();

    expect(result.status).toBe('ok');
    expect(result.scope).toBe('liveness');
    expect(result.uptimeSeconds).toEqual(expect.any(Number));
    expect(result.timestamp).toEqual(expect.any(String));
    expect(mockRedis.ping).not.toHaveBeenCalled();
    expect(mockQdrant.getCollections).not.toHaveBeenCalled();
  });

  it('returns unhealthy readiness when a required dependency is unavailable', async () => {
    mockRedis.ping.mockRejectedValue(new Error('redis down'));
    mockQdrant.getCollections.mockResolvedValue({ collections: [] });

    const result = await service.getReadiness();

    expect(result).toMatchObject({
      status: 'unhealthy',
      scope: 'readiness',
      details: {
        redis: 'unavailable',
        qdrant: 'ok',
      },
    });
  });

  it('returns degraded dependency status when optional providers fail', async () => {
    mockRedis.ping.mockResolvedValue('PONG');
    mockQdrant.getCollections.mockResolvedValue({ collections: [] });
    (axios.get as jest.Mock).mockRejectedValue(new Error('mistral down'));
    (axios.post as jest.Mock).mockResolvedValue({ status: 200 });

    const result = await service.getDependencyReport();

    expect(result).toMatchObject({
      status: 'degraded',
      scope: 'dependencies',
      required: {
        redis: 'ok',
        qdrant: 'ok',
      },
      optional: {
        mistral: 'unavailable',
        tavily: 'ok',
      },
    });
  });

  it('caches optional dependency checks within the configured TTL', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000);
    mockRedis.ping.mockResolvedValue('PONG');
    mockQdrant.getCollections.mockResolvedValue({ collections: [] });
    (axios.get as jest.Mock).mockResolvedValue({ status: 200 });
    (axios.post as jest.Mock).mockResolvedValue({ status: 200 });

    await service.getDependencyReport();
    await service.getDependencyReport();

    expect(axios.get).toHaveBeenCalledTimes(1);
    expect(axios.post).toHaveBeenCalledTimes(1);
    nowSpy.mockRestore();
  });
});
