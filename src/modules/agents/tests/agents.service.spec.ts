import { Test, TestingModule } from '@nestjs/testing';
import { AgentsService } from '../agents.service';
import { RedisService } from '@redis/redis.service';
import { agentGraph } from '../graph/agent.graph';

jest.mock('@config/env', () => ({
  env: {
    cacheTtlSeconds: 60,
    redisHost: 'localhost',
    redisPort: 6379,
  },
}));

jest.mock('../graph/agent.graph', () => ({
  agentGraph: {
    invoke: jest.fn(),
  },
}));

const mockRedisService = {
  get: jest.fn(),
  set: jest.fn(),
};

describe('AgentsService', () => {
  let service: AgentsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentsService,
        { provide: RedisService, useValue: mockRedisService },
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
      agentGraph.invoke.mockResolvedValue({ finalAnswer: 'The answer is 42' });

      const result = await service.run(prompt);

      expect(agentGraph.invoke).toHaveBeenCalledWith({
        input: prompt,
        iteration: 0,
      });
      expect(result).toBe('The answer is 42');
    });

    it('should throw InternalServerErrorException when finalAnswer is missing', async () => {
      agentGraph.invoke.mockResolvedValue({});

      await expect(service.run('prompt')).rejects.toThrow(
        'The agent could not produce an answer',
      );
    });

    it('should wrap unexpected graph errors in InternalServerErrorException', async () => {
      agentGraph.invoke.mockRejectedValue(new Error('LLM timeout'));

      await expect(service.run('prompt')).rejects.toThrow(
        'Agent execution failed: LLM timeout',
      );
    });
  });
});
