import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AgentsController } from '../agents.controller';
import { AgentsService } from '../agents.service';

jest.mock('@config/env', () => ({
  env: {
    cacheTtlSeconds: 60,
    redisHost: 'localhost',
    redisPort: 6379,
  },
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
      const expectedResult = 'AI response';
      mockAgentsService.run.mockResolvedValue(expectedResult);

      const response = await controller.run({ prompt });

      expect(mockAgentsService.run).toHaveBeenCalledWith(prompt);
      expect(response).toEqual({ result: expectedResult });
    });

    it('should propagate errors from the service', async () => {
      mockAgentsService.run.mockRejectedValue(new Error('LLM failed'));

      await expect(controller.run({ prompt: 'fail' })).rejects.toThrow(
        'LLM failed',
      );
    });
  });
});

