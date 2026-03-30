import { AgentsService } from '../agents.service';
import { agentWorkflow } from '../graph/agent.graph';
import type { SessionMemoryService } from '../services/session-memory.service';
import type { PlanReviewService } from '../services/plan-review.service';
import type { SessionService } from '../services/session.service';
import type { FeedbackService } from '../services/feedback.service';
import type { RedisSaver } from '../utils/redis-saver';

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

describe('AgentsService', () => {
  const mockRedisClient = {
    get: jest.fn(),
    set: jest.fn().mockResolvedValue('OK'),
    eval: jest.fn().mockResolvedValue(1),
    setex: jest.fn().mockResolvedValue('OK'),
  };

  const sessionMemoryService = {
    tryLoad: jest.fn(),
    persist: jest.fn().mockResolvedValue(undefined),
    getSessionMemory: jest.fn(),
    addEntry: jest.fn(),
    clear: jest.fn(),
  } as unknown as jest.Mocked<SessionMemoryService>;

  const planReviewService = {
    setApp: jest.fn(),
  } as unknown as jest.Mocked<PlanReviewService>;

  const sessionService = {
    setApp: jest.fn(),
  } as unknown as jest.Mocked<SessionService>;

  const feedbackService = {} as FeedbackService;

  const checkpointer = {
    setVectorMemoryIds: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<RedisSaver>;

  const invoke = jest.fn();
  const mockStream = jest.fn();
  const mockGetState = jest.fn();
  let service: AgentsService;

  beforeEach(() => {
    jest.clearAllMocks();

    const compileMock = agentWorkflow['compile'] as jest.Mock;
    compileMock.mockReturnValue({
      invoke,
      stream: mockStream,
      getState: mockGetState,
    } as any);

    sessionMemoryService.tryLoad.mockResolvedValue(undefined);
    sessionMemoryService.getSessionMemory.mockResolvedValue({
      sessionId: 'session',
      entries: [],
      raw: '',
    });
    sessionMemoryService.addEntry.mockResolvedValue({
      sessionId: 'session',
      entries: ['new fact'],
      raw: 'new fact',
    });
    sessionMemoryService.clear.mockResolvedValue(undefined);
    mockRedisClient.get.mockResolvedValue(null);

    service = new AgentsService(
      mockRedisClient as any,
      sessionMemoryService,
      planReviewService,
      sessionService,
      feedbackService,
      checkpointer,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
    expect(planReviewService.setApp).toHaveBeenCalled();
    expect(sessionService.setApp).toHaveBeenCalled();
  });

  describe('run', () => {
    it('should invoke the agent graph and return finalAnswer', async () => {
      invoke.mockResolvedValue({ finalAnswer: 'The answer is 42' });

      const result = await service.run('test prompt', 'session-1');

      expect(invoke.mock.calls[0]?.[0]).toMatchObject({ input: 'test prompt' });
      expect(result.result).toBe('The answer is 42');
      expect(result.sessionId).toBe('session-1');
    });

    it('should throw InternalServerErrorException when finalAnswer is missing', async () => {
      invoke.mockResolvedValue({});

      await expect(service.run('prompt', 'session-1')).rejects.toThrow(
        'The agent could not produce an answer',
      );
    });

    it('should wrap unexpected graph errors in InternalServerErrorException', async () => {
      invoke.mockRejectedValue(new Error('LLM timeout'));

      await expect(service.run('prompt', 'session-1')).rejects.toThrow(
        'Agent execution failed: LLM timeout',
      );
    });

    it('uses different cache keys when image inputs differ', async () => {
      invoke.mockResolvedValue({ finalAnswer: 'cached answer' });

      await service.run('prompt', 'session-1', [{ url: 'https://example.com/a.png' }]);
      await service.run('prompt', 'session-1', [{ url: 'https://example.com/b.png' }]);

      expect(mockRedisClient.get).toHaveBeenCalledTimes(2);
      expect(mockRedisClient.get.mock.calls[0]?.[0]).not.toBe(
        mockRedisClient.get.mock.calls[1]?.[0],
      );
    });
  });

  describe('streamRun — token-drain logic', () => {
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
      mockStream.mockImplementation(async function* (state: any) {
        state.onToken?.('Hello');
        state.onToken?.(' world');
        yield { chatNode: { phase: 'chat' } };
      });

      mockGetState.mockResolvedValue({
        values: { phase: 'complete', finalAnswer: 'done' },
      });

      const events = await collectEvents(
        service.streamRun('test prompt', 'session-1'),
      );

      const types = events.map((e) => e.type);
      expect(types).toContain('llm_stream_reset');
      expect(types.filter((t) => t === 'llm_token')).toHaveLength(2);
    });

    it('yields no llm_stream_reset or llm_token events when no onToken is called', async () => {
      mockStream.mockImplementation(async function* (_state: any) {
        yield { chatNode: { phase: 'chat' } };
      });

      mockGetState.mockResolvedValue({
        values: { phase: 'complete', finalAnswer: 'done' },
      });

      const events = await collectEvents(
        service.streamRun('test prompt', 'session-1'),
      );

      const types = events.map((e) => e.type);
      expect(types).not.toContain('llm_stream_reset');
      expect(types).not.toContain('llm_token');
    });
  });

  describe('session memory', () => {
    it('getSessionMemory delegates to SessionMemoryService', async () => {
      await service.getSessionMemory('session');

      expect(sessionMemoryService.getSessionMemory).toHaveBeenCalledWith(
        'session',
      );
    });

    it('addSessionMemoryEntry delegates to SessionMemoryService', async () => {
      await service.addSessionMemoryEntry('session', 'new fact');

      expect(sessionMemoryService.addEntry).toHaveBeenCalledWith(
        'session',
        'new fact',
      );
    });

    it('clearSessionMemory delegates to SessionMemoryService', async () => {
      await service.clearSessionMemory('session');

      expect(sessionMemoryService.clear).toHaveBeenCalledWith('session');
    });
  });
});
