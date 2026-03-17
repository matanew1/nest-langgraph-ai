import { RedisSaver } from './redis-saver';

jest.mock('@config/env', () => ({
  env: {
    sessionTtlSeconds: 3600,
  },
}));

interface ZsetEntry {
  score: number;
  member: string;
}

class FakePipeline {
  private readonly operations: Array<() => void> = [];

  constructor(private readonly redis: FakeRedis) {}

  set(key: string, value: string | Buffer, ..._args: unknown[]) {
    this.operations.push(() => {
      this.redis.set(key, value);
    });
    return this;
  }

  zadd(key: string, score: number, member: string) {
    this.operations.push(() => {
      this.redis.zadd(key, score, member);
    });
    return this;
  }

  expire(_key: string, _ttl: number) {
    return this;
  }

  sadd(key: string, member: string) {
    this.operations.push(() => {
      this.redis.sadd(key, member);
    });
    return this;
  }

  hsetnx(key: string, field: string, value: string) {
    this.operations.push(() => {
      this.redis.hsetnx(key, field, value);
    });
    return this;
  }

  hset(key: string, field: string, value: string) {
    this.operations.push(() => {
      this.redis.hset(key, field, value);
    });
    return this;
  }

  zremrangebyrank(key: string, start: number, end: number) {
    this.operations.push(() => {
      this.redis.zremrangebyrank(key, start, end);
    });
    return this;
  }

  del(key: string) {
    this.operations.push(() => {
      this.redis.del(key);
    });
    return this;
  }

  exec() {
    this.operations.forEach((operation) => operation());
    return Promise.resolve([]);
  }
}

class FakeRedis {
  private readonly strings = new Map<string, string | Buffer>();
  private readonly hashes = new Map<string, Map<string, string>>();
  private readonly sets = new Map<string, Set<string>>();
  private readonly zsets = new Map<string, ZsetEntry[]>();

  get(key: string): Promise<string | null> {
    const value = this.strings.get(key);
    if (value === undefined) return Promise.resolve(null);
    return Promise.resolve(Buffer.isBuffer(value) ? value.toString() : value);
  }

  getBuffer(key: string): Promise<Buffer | null> {
    const value = this.strings.get(key);
    if (value === undefined) return Promise.resolve(null);
    return Promise.resolve(Buffer.isBuffer(value) ? value : Buffer.from(value));
  }

  set(key: string, value: string | Buffer): Promise<'OK'> {
    this.strings.set(key, Buffer.isBuffer(value) ? Buffer.from(value) : value);
    return Promise.resolve('OK');
  }

  hgetall(key: string): Promise<Record<string, string>> {
    return Promise.resolve(Object.fromEntries(this.hashes.get(key) ?? []));
  }

  smembers(key: string): Promise<string[]> {
    return Promise.resolve(Array.from(this.sets.get(key) ?? []));
  }

  zrange(key: string, start: number, end: number): Promise<string[]> {
    return Promise.resolve(this.readZset(key, start, end, false));
  }

  zrevrange(key: string, start: number, end: number): Promise<string[]> {
    return Promise.resolve(this.readZset(key, start, end, true));
  }

  pipeline(): FakePipeline {
    return new FakePipeline(this);
  }

  zadd(key: string, score: number, member: string) {
    const entries = this.zsets.get(key) ?? [];
    const next = entries.filter((entry) => entry.member !== member);
    next.push({ score, member });
    next.sort((left, right) => left.score - right.score);
    this.zsets.set(key, next);
  }

  sadd(key: string, member: string) {
    const values = this.sets.get(key) ?? new Set<string>();
    values.add(member);
    this.sets.set(key, values);
  }

  hset(key: string, field: string, value: string) {
    const map = this.hashes.get(key) ?? new Map<string, string>();
    map.set(field, value);
    this.hashes.set(key, map);
  }

  hsetnx(key: string, field: string, value: string) {
    const map = this.hashes.get(key) ?? new Map<string, string>();
    if (!map.has(field)) {
      map.set(field, value);
      this.hashes.set(key, map);
    }
  }

  del(key: string) {
    this.strings.delete(key);
    this.hashes.delete(key);
    this.sets.delete(key);
    this.zsets.delete(key);
  }

  zremrangebyrank(key: string, start: number, end: number) {
    const entries = this.zsets.get(key) ?? [];
    if (entries.length === 0) return;

    const normalizedStart = start < 0 ? Math.max(entries.length + start, 0) : start;
    const normalizedEnd =
      end < 0 ? Math.max(entries.length + end, -1) : end;

    if (normalizedStart > normalizedEnd || normalizedEnd < 0) return;

    entries.splice(normalizedStart, normalizedEnd - normalizedStart + 1);
    this.zsets.set(key, entries);
  }

  private readZset(
    key: string,
    start: number,
    end: number,
    reverse: boolean,
  ): string[] {
    const base = [...(this.zsets.get(key) ?? [])];
    if (reverse) base.reverse();

    const normalizedEnd = end < 0 ? base.length + end : end;
    return base
      .slice(start, normalizedEnd + 1)
      .map((entry) => entry.member);
  }
}

function checkpoint(id: string) {
  return {
    v: 4,
    id,
    ts: new Date().toISOString(),
    channel_values: {},
    channel_versions: {},
    versions_seen: {},
  };
}

describe('RedisSaver', () => {
  let redis: FakeRedis;
  let saver: RedisSaver;

  beforeEach(() => {
    redis = new FakeRedis();
    saver = new RedisSaver(redis as any);
  });

  it('stores and loads namespaced checkpoints with parent linkage', async () => {
    await saver.put(
      {
        configurable: {
          thread_id: 'thread-1',
          checkpoint_ns: 'feature/x',
          checkpoint_id: 'parent-1',
        },
      },
      checkpoint('cp-1'),
      { source: 'loop', step: 1, parents: {} },
    );

    const tuple = await saver.getTuple({
      configurable: { thread_id: 'thread-1', checkpoint_ns: 'feature/x' },
    });

    expect(tuple?.config.configurable?.checkpoint_id).toBe('cp-1');
    expect(tuple?.config.configurable?.checkpoint_ns).toBe('feature/x');
    expect(tuple?.parentConfig?.configurable?.checkpoint_id).toBe('parent-1');
  });

  it('round-trips pending writes for a checkpoint', async () => {
    await saver.put(
      { configurable: { thread_id: 'thread-2' } },
      checkpoint('cp-2'),
      { source: 'loop', step: 1, parents: {} },
    );

    await saver.putWrites(
      {
        configurable: { thread_id: 'thread-2', checkpoint_id: 'cp-2' },
      },
      [
        ['return', { ok: true }],
        ['custom', 'value'],
      ],
      'task-1',
    );

    const tuple = await saver.getTuple({
      configurable: { thread_id: 'thread-2', checkpoint_id: 'cp-2' },
    });

    expect(tuple?.pendingWrites).toEqual(
      expect.arrayContaining([
        ['task-1', 'return', { ok: true }],
        ['task-1', 'custom', 'value'],
      ]),
    );
  });

  it('deletes checkpoints and thread memory together', async () => {
    await saver.put(
      { configurable: { thread_id: 'thread-3' } },
      checkpoint('cp-3'),
      { source: 'loop', step: 1, parents: {} },
    );
    await saver.setThreadMemory('thread-3', 'short memory');

    await saver.deleteThread('thread-3');

    await expect(
      saver.getTuple({ configurable: { thread_id: 'thread-3' } }),
    ).resolves.toBeUndefined();
    await expect(saver.getThreadMemory('thread-3')).resolves.toBeUndefined();
  });
});
