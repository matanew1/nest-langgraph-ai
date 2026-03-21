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
  const mockStream = jest.fn();
  const mockGetState = jest.fn();
  let mockApp: { invoke: jest.Mock; stream: jest.Mock; getState: jest.Mock };

  beforeEach(async () => {
    mockApp = { invoke, stream: mockStream, getState: mockGetState };

    const compileMock = agentWorkflow['compile'] as jest.Mock;
    compileMock.mockReturnValue(mockApp as any);

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

  describe('streamRun — token-drain logic', () => {
    /** Helper: collect all events from the streamRun async generator. */
    async function collectEvents(
      gen: AsyncGenerator<any>,
    ): Promise<Array<{ type: string; data: string }>> {
      const events: Array<{ type: string; data: string }> = [];
      for await (const event of gen) {
        events.push(event);
      }
      return events;
    }

    it('yields llm_stream_reset and llm_token events after a node that triggers onToken', async () => {
      // Mock stream: capture onToken from the state and call it with two tokens,
      // then yield a fake node event so the for-await loop has something to iterate.
      mockStream.mockImplementation(async function* (state: any) {
        state.onToken?.('Hello');
        state.onToken?.(' world');
        yield { chatNode: { phase: 'chat' } };
      });

      mockGetState.mockResolvedValue({
        values: { phase: 'complete', finalAnswer: 'done' },
      });

      const events = await collectEvents(service.streamRun('test prompt'));

      const types = events.map((e) => e.type);
      expect(types).toContain('llm_stream_reset');
      expect(types.filter((t) => t === 'llm_token')).toHaveLength(2);

      const tokenEvents = events.filter((e) => e.type === 'llm_token');
      expect(tokenEvents[0].data).toBe('Hello');
      expect(tokenEvents[1].data).toBe(' world');
    });

    it('yields no llm_stream_reset or llm_token events when no onToken is called', async () => {
      // Mock stream: yield a node event without touching onToken.
      mockStream.mockImplementation(async function* (_state: any) {
        yield { chatNode: { phase: 'chat' } };
      });

      mockGetState.mockResolvedValue({
        values: { phase: 'complete', finalAnswer: 'done' },
      });

      const events = await collectEvents(service.streamRun('test prompt'));

      const types = events.map((e) => e.type);
      expect(types).not.toContain('llm_stream_reset');
      expect(types).not.toContain('llm_token');
    });
  });
});
