import { Test, TestingModule } from '@nestjs/testing';
import { AgentsService } from '../agents.service';
import { REDIS_CLIENT } from '@redis/redis.constants';
import { agentWorkflow } from '../graph/agent.graph';

jest.mock('@config/env', () => ({
  env: {
    cacheTtlSeconds: 60,
    sessionTtlSeconds: 86400,
    mistralTimeoutMs: 5000,
    agentMaxIterations: 3,
    agentMaxRetries: 3,
  },
}));

jest.mock('../graph/agent.graph', () => ({
  agentWorkflow: {
    compile: jest.fn(),
  },
}));

const mockRedisClient = {
  get: jest.fn(),
  set: jest.fn(),
  setex: jest.fn(),
  getBuffer: jest.fn(),
  pipeline: jest.fn().mockReturnValue({
    del: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    sadd: jest.fn().mockReturnThis(),
    expire: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([]),
  }),
  smembers: jest.fn().mockResolvedValue([]),
};

describe('AgentsService', () => {
  let service: AgentsService;
  const invoke = jest.fn();

  beforeEach(async () => {
    const compileMock = agentWorkflow['compile'] as jest.Mock;
    compileMock.mockReturnValue({
      invoke,
      stream: jest.fn(),
      getState: jest.fn(),
    } as any);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentsService,
        { provide: REDIS_CLIENT, useValue: mockRedisClient },
      ],
    }).compile();

    service = module.get<AgentsService>(AgentsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('run', () => {
    it('should invoke the agent graph and return finalAnswer', async () => {
      const prompt = 'test prompt';
      invoke.mockResolvedValue({ finalAnswer: 'The answer is 42' });

      const result = await service.run(prompt);

      expect(invoke.mock.calls[0]?.[0]).toMatchObject({ input: prompt });
      expect(result.result).toBe('The answer is 42');
      expect(result.sessionId).toBeDefined();
    });

    it('should throw InternalServerErrorException when finalAnswer is missing', async () => {
      invoke.mockResolvedValue({});

      await expect(service.run('prompt')).rejects.toThrow(
        'The agent could not produce an answer',
      );
    });

    it('should wrap unexpected graph errors in InternalServerErrorException', async () => {
      invoke.mockRejectedValue(new Error('LLM timeout'));

      await expect(service.run('prompt')).rejects.toThrow(
        'Agent execution failed: LLM timeout',
      );
    });
  });
});
