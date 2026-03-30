import { FeedbackService } from './feedback.service';

const mockUpdatePointSalience = jest.fn();

jest.mock('@config/env', () => ({
  env: {
    sessionTtlSeconds: 3600,
  },
}));

jest.mock('../../vector-db/vector-memory.util', () => ({
  updatePointSalience: (...args: unknown[]) => mockUpdatePointSalience(...args),
}));

describe('FeedbackService', () => {
  const redisClient = {
    get: jest.fn(),
    set: jest.fn().mockResolvedValue('OK'),
  };
  const checkpointer = {
    getVectorMemoryIds: jest.fn(),
  };

  let service: FeedbackService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new FeedbackService(redisClient as any, checkpointer as any);
  });

  it('returns cached stats for repeated submissions with the same rating', async () => {
    redisClient.get.mockResolvedValue(
      JSON.stringify({
        sessionId: 'session-1',
        rating: 'positive',
        submittedAt: '2026-03-30T00:00:00.000Z',
        pointsUpdated: 2,
      }),
    );

    const result = await service.submitFeedback('session-1', {
      rating: 'positive',
    } as any);

    expect(result.rating).toBe('positive');
    expect(mockUpdatePointSalience).not.toHaveBeenCalled();
    expect(redisClient.set).not.toHaveBeenCalled();
  });

  it('reapplies salience when the rating changes for an existing session', async () => {
    redisClient.get.mockResolvedValue(
      JSON.stringify({
        sessionId: 'session-1',
        rating: 'negative',
        submittedAt: '2026-03-30T00:00:00.000Z',
        pointsUpdated: 1,
      }),
    );
    checkpointer.getVectorMemoryIds.mockResolvedValue(['point-1', 'point-2']);
    mockUpdatePointSalience.mockResolvedValue(undefined);

    const result = await service.submitFeedback('session-1', {
      rating: 'positive',
    } as any);

    expect(result.rating).toBe('positive');
    expect(mockUpdatePointSalience).toHaveBeenCalledTimes(2);
    expect(mockUpdatePointSalience).toHaveBeenCalledWith('point-1', 0.9);
    expect(mockUpdatePointSalience).toHaveBeenCalledWith('point-2', 0.9);
    expect(redisClient.set).toHaveBeenCalled();
  });
});
