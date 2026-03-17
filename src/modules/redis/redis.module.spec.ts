import { Logger } from '@nestjs/common';

const mockRedis = {
  status: 'wait',
  connect: jest.fn(),
  disconnect: jest.fn(),
};

jest.mock('./redis.provider', () => ({
  redis: mockRedis,
}));

import { RedisModule } from './redis.module';

describe('RedisModule', () => {
  beforeEach(() => {
    mockRedis.status = 'wait';
    mockRedis.connect.mockReset();
    mockRedis.disconnect.mockReset();
    jest.restoreAllMocks();
  });

  it('connects Redis during module init when the client is idle', async () => {
    mockRedis.connect.mockResolvedValue(undefined);

    await expect(
      new RedisModule(mockRedis as any).onModuleInit(),
    ).resolves.toBeUndefined();

    expect(mockRedis.connect).toHaveBeenCalledTimes(1);
  });

  it('skips the initial connect when Redis is already connecting', async () => {
    mockRedis.status = 'connecting';

    await expect(
      new RedisModule(mockRedis as any).onModuleInit(),
    ).resolves.toBeUndefined();

    expect(mockRedis.connect).not.toHaveBeenCalled();
  });

  it('logs startup connection failures without crashing init', async () => {
    const errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    mockRedis.connect.mockRejectedValue(new Error('Connection is closed.'));

    await expect(
      new RedisModule(mockRedis as any).onModuleInit(),
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'Redis connection failed at startup: Connection is closed.',
      ),
    );
  });

  it('disconnects Redis on application shutdown when the client is active', () => {
    new RedisModule(mockRedis as any).onApplicationShutdown();

    expect(mockRedis.disconnect).toHaveBeenCalledWith(false);
  });

  it('skips Redis disconnect on application shutdown when the client has ended', () => {
    mockRedis.status = 'end';

    new RedisModule(mockRedis as any).onApplicationShutdown();

    expect(mockRedis.disconnect).not.toHaveBeenCalled();
  });
});
