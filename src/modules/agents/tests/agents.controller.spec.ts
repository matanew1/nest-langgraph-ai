import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AgentsController } from '../agents.controller';
import { AgentsService } from '../agents.service';

jest.mock('@config/env', () => ({
  env: {
    cacheTtlSeconds: 60,
    sessionTtlSeconds: 86400,
    redisHost: 'localhost',
    redisPort: 6379,
    agentMaxIterations: 3,
    agentMaxRetries: 3,
    mistralTimeoutMs: 5000,
    promptMaxSummaryChars: 1200,
  },
}));

jest.mock('@llm/llm.provider', () => ({
  invokeLlm: jest.fn(),
}));

jest.mock('@vector-db/vector-memory.util', () => ({
  upsertVectorMemory: jest.fn(),
  buildVectorResearchContext: jest.fn(),
}));

jest.mock('@redis/redis.provider', () => ({
  redis: {
    get: jest.fn(),
    set: jest.fn(),
  },
}));

// Mock path matches service import and spec
jest.mock('../graph/agent.graph', () => ({
  agentGraph: {
    invoke: jest.fn(),
  },
}));

describe('AgentsController', () => {
  let controller: AgentsController;

  const mockAgentsService = {
    run: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AgentsController],
      providers: [{ provide: AgentsService, useValue: mockAgentsService }],
    })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AgentsController>(AgentsController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('run', () => {
    it('should call agentsService.run and return the result', async () => {
      const prompt = 'test prompt';
      const expected = { result: 'AI response', sessionId: 'session-123' };
      mockAgentsService.run.mockResolvedValue(expected);

      const response = await controller.run({ prompt });

      expect(mockAgentsService.run).toHaveBeenCalledWith(prompt, undefined);
      expect(response).toEqual(expected);
    });

    it('should propagate errors from the service', async () => {
      mockAgentsService.run.mockRejectedValue(new Error('LLM failed'));

      await expect(controller.run({ prompt: 'fail' })).rejects.toThrow(
        'LLM failed',
      );
    });
  });
});
