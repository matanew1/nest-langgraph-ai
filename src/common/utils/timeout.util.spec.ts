import { withTimeout } from './timeout.util';

describe('withTimeout', () => {
  it('resolves the wrapped promise result', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 100, 'test')).resolves.toBe(
      'ok',
    );
  });

  it('rejects when the timeout fires first', async () => {
    await expect(
      withTimeout(
        new Promise((resolve) => setTimeout(() => resolve('late'), 20)),
        1,
        'slow',
      ),
    ).rejects.toThrow('slow timed out after 1ms');
  });
});
