import {
  BaseCheckpointSaver,
  Checkpoint,
  CheckpointListOptions,
  CheckpointMetadata,
  CheckpointTuple,
  SerializerProtocol,
  WRITES_IDX_MAP,
} from '@langchain/langgraph-checkpoint';
import { RunnableConfig } from '@langchain/core/runnables';
import { Redis } from 'ioredis';
import { env } from '@config/env';
import { AGENT_CONSTANTS } from '../graph/agent.config';
import { Logger, NotFoundException } from '@nestjs/common';
import { Buffer } from 'buffer';

class DefaultSerializer implements SerializerProtocol {
  dumpsTyped(obj: unknown): Promise<[string, Uint8Array]> {
    const data = new TextEncoder().encode(JSON.stringify(obj));
    return Promise.resolve(['json', data]);
  }

  loadsTyped(_type: string, data: string | Uint8Array): Promise<unknown> {
    const decoded =
      typeof data === 'string' ? data : new TextDecoder().decode(data);

    return Promise.resolve(JSON.parse(decoded));
  }
}

interface StoredCheckpointRecord {
  checkpoint: Checkpoint;
  metadata?: CheckpointMetadata;
  parentCheckpointId?: string;
  checkpointNamespace: string;
}

type PendingWriteTuple = [string, string, unknown];

export class RedisSaver extends BaseCheckpointSaver {
  private readonly client: Redis;
  private readonly logger = new Logger(RedisSaver.name);
  private readonly ttlSeconds: number;
  private readonly historyLimit = AGENT_CONSTANTS.checkpointHistoryLimit;
  private readonly defaultNamespaceToken = 'default';

  constructor(redisClient: Redis) {
    super(new DefaultSerializer());
    this.client = redisClient;
    this.ttlSeconds = env.sessionTtlSeconds;
  }

  /**
   * Retry a Redis pipeline execution with exponential backoff.
   * Only retries on transient errors (connection refused, reset, timeout).
   */
  private async execWithRetry(
    pipeline: ReturnType<Redis['pipeline']>,
    retries = 3,
  ): Promise<[error: Error | null, result: unknown][] | null> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await pipeline.exec();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const isTransient =
          message.includes('ECONNREFUSED') ||
          message.includes('ECONNRESET') ||
          message.includes('ETIMEDOUT') ||
          message.includes('Connection is closed');

        if (!isTransient || attempt >= retries) throw err;

        const backoffMs = 100 * Math.pow(2, attempt);
        this.logger.warn(
          `Redis pipeline failed (attempt ${attempt + 1}/${retries + 1}): ${message} — retrying in ${backoffMs}ms`,
        );
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    }
    return null;
  }

  private getCheckpointNamespace(config: RunnableConfig): string {
    return config.configurable?.checkpoint_ns ?? '';
  }

  private encodeNamespace(namespace = ''): string {
    return namespace
      ? encodeURIComponent(namespace)
      : this.defaultNamespaceToken;
  }

  private decodeNamespace(token: string): string {
    return token === this.defaultNamespaceToken
      ? ''
      : decodeURIComponent(token);
  }

  private getLegacyThreadKey(threadId: string): string {
    return `agent:thread:${threadId}`;
  }

  private getThreadNamespacesKey(threadId: string): string {
    return `agent:thread:${threadId}:namespaces`;
  }

  private getThreadLatestKey(threadId: string, namespace = ''): string {
    return `agent:thread:${threadId}:ns:${this.encodeNamespace(namespace)}:latest`;
  }

  private getThreadHistoryKey(threadId: string, namespace = ''): string {
    return `agent:thread:${threadId}:ns:${this.encodeNamespace(namespace)}:history`;
  }

  private getLegacyCheckpointSetKey(threadId: string): string {
    return `agent:thread:${threadId}:checkpoints`;
  }

  private getCheckpointKey(checkpointId: string): string {
    return `agent:checkpoint:${checkpointId}`;
  }

  private getMetadataKey(checkpointId: string): string {
    return `agent:checkpoint_metadata:${checkpointId}`;
  }

  private getCheckpointRecordKey(checkpointId: string): string {
    return `agent:checkpoint_record:${checkpointId}`;
  }

  private getCheckpointWritesKey(checkpointId: string): string {
    return `agent:checkpoint_writes:${checkpointId}`;
  }

  private getThreadMemoryKey(threadId: string): string {
    return `agent:thread:${threadId}:memory`;
  }

  private getVectorIdsKey(threadId: string): string {
    return `agent:thread:${threadId}:vector_ids`;
  }

  private async loadRecord(
    checkpointId: string,
  ): Promise<StoredCheckpointRecord | undefined> {
    const recordData = await this.client.getBuffer(
      this.getCheckpointRecordKey(checkpointId),
    );

    if (recordData) {
      return (await this.serde.loadsTyped(
        'json',
        recordData,
      )) as StoredCheckpointRecord;
    }

    const [checkpointData, metadataData] = await Promise.all([
      this.client.getBuffer(this.getCheckpointKey(checkpointId)),
      this.client.getBuffer(this.getMetadataKey(checkpointId)),
    ]);

    if (!checkpointData) return undefined;

    return {
      checkpoint: (await this.serde.loadsTyped(
        'json',
        checkpointData,
      )) as Checkpoint,
      metadata: metadataData
        ? ((await this.serde.loadsTyped(
            'json',
            metadataData,
          )) as CheckpointMetadata)
        : ({} as CheckpointMetadata),
      checkpointNamespace: '',
    };
  }

  private async loadPendingWrites(
    checkpointId: string,
  ): Promise<PendingWriteTuple[]> {
    const data = await this.client.hgetall(
      this.getCheckpointWritesKey(checkpointId),
    );
    const entries = Object.entries(data).sort(([left], [right]) => {
      const [, leftIndex = '0'] = left.split(',');
      const [, rightIndex = '0'] = right.split(',');
      return Number(leftIndex) - Number(rightIndex);
    });

    const writes = await Promise.all(
      entries.map(async ([, encoded]) => {
        return (await this.serde.loadsTyped(
          'json',
          Buffer.from(encoded, 'base64'),
        )) as PendingWriteTuple;
      }),
    );

    return writes;
  }

  private buildTuple(
    threadId: string,
    checkpointId: string,
    record: StoredCheckpointRecord,
    pendingWrites: PendingWriteTuple[],
  ): CheckpointTuple {
    const checkpointNamespace = record.checkpointNamespace ?? '';
    const tuple: CheckpointTuple = {
      config: {
        configurable: {
          thread_id: threadId,
          checkpoint_id: checkpointId,
          checkpoint_ns: checkpointNamespace,
        },
      },
      checkpoint: record.checkpoint,
      metadata: (record.metadata ?? {}) as CheckpointMetadata,
      pendingWrites,
    };

    if (record.parentCheckpointId) {
      tuple.parentConfig = {
        configurable: {
          thread_id: threadId,
          checkpoint_id: record.parentCheckpointId,
          checkpoint_ns: checkpointNamespace,
        },
      };
    }

    return tuple;
  }

  private async getTrackedNamespaces(threadId: string): Promise<string[]> {
    const tokens = await this.client.smembers(
      this.getThreadNamespacesKey(threadId),
    );
    const namespaces = new Set(
      tokens.map((token) => this.decodeNamespace(token)),
    );
    namespaces.add('');
    return Array.from(namespaces);
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const threadId = config.configurable?.thread_id;
    if (!threadId) {
      throw new Error('Thread ID is not configured.');
    }

    const checkpointNamespace = this.getCheckpointNamespace(config);
    let checkpointId = config.configurable?.checkpoint_id;

    if (!checkpointId) {
      checkpointId =
        (await this.client.get(
          this.getThreadLatestKey(threadId, checkpointNamespace),
        )) ??
        (checkpointNamespace === ''
          ? await this.client.get(this.getLegacyThreadKey(threadId))
          : undefined);
    }

    if (!checkpointId) return undefined;

    const record = await this.loadRecord(checkpointId);
    if (!record) return undefined;

    const pendingWrites = await this.loadPendingWrites(checkpointId);

    this.logger.log(
      `📥 Loaded checkpoint for thread "${threadId}" (ns="${record.checkpointNamespace ?? checkpointNamespace}", id: ${checkpointId})`,
    );

    return this.buildTuple(threadId, checkpointId, record, pendingWrites);
  }

  async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions,
  ): AsyncGenerator<CheckpointTuple> {
    const threadId = config.configurable?.thread_id;
    if (!threadId) return;

    const requestedNamespace = config.configurable?.checkpoint_ns;
    const namespaces =
      requestedNamespace !== undefined
        ? [requestedNamespace]
        : await this.getTrackedNamespaces(threadId);

    let remaining = options?.limit;

    for (const checkpointNamespace of namespaces) {
      const historyIds = await this.client.zrevrange(
        this.getThreadHistoryKey(threadId, checkpointNamespace),
        0,
        -1,
      );

      const legacyIds =
        checkpointNamespace === ''
          ? await this.client.smembers(this.getLegacyCheckpointSetKey(threadId))
          : [];

      const checkpointIds = Array.from(new Set([...historyIds, ...legacyIds]));

      for (const checkpointId of checkpointIds) {
        if (
          options?.before?.configurable?.checkpoint_id &&
          checkpointId >= options.before.configurable.checkpoint_id
        ) {
          continue;
        }

        if (
          config.configurable?.checkpoint_id &&
          checkpointId !== config.configurable.checkpoint_id
        ) {
          continue;
        }

        const record = await this.loadRecord(checkpointId);
        if (!record) continue;

        const metadata = (record.metadata ?? {}) as CheckpointMetadata;
        if (
          options?.filter &&
          !Object.entries(options.filter).every(
            ([key, value]) =>
              (metadata as Record<string, unknown>)[key] === value,
          )
        ) {
          continue;
        }

        const pendingWrites = await this.loadPendingWrites(checkpointId);
        yield this.buildTuple(threadId, checkpointId, record, pendingWrites);

        if (remaining !== undefined) {
          remaining -= 1;
          if (remaining <= 0) return;
        }
      }
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    _newVersions?: Record<string, string | number>,
  ): Promise<RunnableConfig> {
    const threadId = config.configurable?.thread_id;
    if (!threadId) {
      throw new Error(
        'Failed to put checkpoint. The passed RunnableConfig is missing thread_id.',
      );
    }

    const checkpointNamespace = this.getCheckpointNamespace(config);
    const record: StoredCheckpointRecord = {
      checkpoint,
      metadata,
      parentCheckpointId: config.configurable?.checkpoint_id,
      checkpointNamespace,
    };

    const latestKey = this.getThreadLatestKey(threadId, checkpointNamespace);
    const historyKey = this.getThreadHistoryKey(threadId, checkpointNamespace);
    const namespacesKey = this.getThreadNamespacesKey(threadId);
    const legacyThreadKey = this.getLegacyThreadKey(threadId);
    const legacySetKey = this.getLegacyCheckpointSetKey(threadId);
    const recordKey = this.getCheckpointRecordKey(checkpoint.id);
    const [, recordBytes] = await this.serde.dumpsTyped(record);

    const pipeline = this.client.pipeline();

    if (this.ttlSeconds > 0) {
      pipeline.set(recordKey, Buffer.from(recordBytes), 'EX', this.ttlSeconds);
      pipeline.set(latestKey, checkpoint.id, 'EX', this.ttlSeconds);
      pipeline.zadd(historyKey, Date.now(), checkpoint.id);
      pipeline.expire(historyKey, this.ttlSeconds);
      pipeline.sadd(namespacesKey, this.encodeNamespace(checkpointNamespace));
      pipeline.expire(namespacesKey, this.ttlSeconds);

      if (checkpointNamespace === '') {
        pipeline.set(legacyThreadKey, checkpoint.id, 'EX', this.ttlSeconds);
        pipeline.sadd(legacySetKey, checkpoint.id);
        pipeline.expire(legacySetKey, this.ttlSeconds);
      }
    } else {
      pipeline.set(recordKey, Buffer.from(recordBytes));
      pipeline.set(latestKey, checkpoint.id);
      pipeline.zadd(historyKey, Date.now(), checkpoint.id);
      pipeline.sadd(namespacesKey, this.encodeNamespace(checkpointNamespace));

      if (checkpointNamespace === '') {
        pipeline.set(legacyThreadKey, checkpoint.id);
        pipeline.sadd(legacySetKey, checkpoint.id);
      }
    }

    pipeline.zremrangebyrank(historyKey, 0, -(this.historyLimit + 1));
    await this.execWithRetry(pipeline);

    return {
      configurable: {
        thread_id: threadId,
        checkpoint_id: checkpoint.id,
        checkpoint_ns: checkpointNamespace,
      },
    };
  }

  async putWrites(
    config: RunnableConfig,
    writes: Array<[string, unknown]>,
    taskId: string,
  ): Promise<void> {
    const threadId = config.configurable?.thread_id;
    const checkpointId = config.configurable?.checkpoint_id;

    if (!threadId) {
      throw new Error(
        'Failed to put writes. The passed RunnableConfig is missing thread_id.',
      );
    }
    if (!checkpointId) {
      throw new Error(
        'Failed to put writes. The passed RunnableConfig is missing checkpoint_id.',
      );
    }
    if (writes.length === 0) return;

    const writesKey = this.getCheckpointWritesKey(checkpointId);
    const pipeline = this.client.pipeline();

    for (const [index, [channel, value]] of writes.entries()) {
      const fieldIndex = WRITES_IDX_MAP[channel] ?? index;
      const field = `${taskId},${fieldIndex}`;
      const [, serializedWrite] = await this.serde.dumpsTyped([
        taskId,
        channel,
        value,
      ]);
      const encoded = Buffer.from(serializedWrite).toString('base64');

      if (fieldIndex >= 0) {
        pipeline.hsetnx(writesKey, field, encoded);
      } else {
        pipeline.hset(writesKey, field, encoded);
      }
    }

    if (this.ttlSeconds > 0) {
      pipeline.expire(writesKey, this.ttlSeconds);
    }

    await this.execWithRetry(pipeline);
  }

  public async deleteThread(threadId: string): Promise<void> {
    const namespaces = await this.getTrackedNamespaces(threadId);
    const checkpointIds = new Set<string>();

    for (const checkpointNamespace of namespaces) {
      const historyIds = await this.client.zrange(
        this.getThreadHistoryKey(threadId, checkpointNamespace),
        0,
        -1,
      );
      historyIds.forEach((id) => checkpointIds.add(id));

      const latestId = await this.client.get(
        this.getThreadLatestKey(threadId, checkpointNamespace),
      );
      if (latestId) checkpointIds.add(latestId);
    }

    const legacyIds = await this.client.smembers(
      this.getLegacyCheckpointSetKey(threadId),
    );
    legacyIds.forEach((id) => checkpointIds.add(id));

    const legacyLatest = await this.client.get(
      this.getLegacyThreadKey(threadId),
    );
    if (legacyLatest) checkpointIds.add(legacyLatest);

    if (checkpointIds.size === 0) {
      throw new NotFoundException(
        `Thread ID "${threadId}" not found or has no associated checkpoints.`,
      );
    }

    const pipeline = this.client.pipeline();

    for (const checkpointId of checkpointIds) {
      pipeline.del(this.getCheckpointRecordKey(checkpointId));
      pipeline.del(this.getCheckpointWritesKey(checkpointId));
      pipeline.del(this.getCheckpointKey(checkpointId));
      pipeline.del(this.getMetadataKey(checkpointId));
    }

    for (const checkpointNamespace of namespaces) {
      pipeline.del(this.getThreadLatestKey(threadId, checkpointNamespace));
      pipeline.del(this.getThreadHistoryKey(threadId, checkpointNamespace));
    }

    pipeline.del(this.getThreadNamespacesKey(threadId));
    pipeline.del(this.getLegacyThreadKey(threadId));
    pipeline.del(this.getLegacyCheckpointSetKey(threadId));
    pipeline.del(this.getThreadMemoryKey(threadId));
    pipeline.del(this.getVectorIdsKey(threadId));
    await this.execWithRetry(pipeline);

    this.logger.log(
      `🗑️ Deleted session state and ${checkpointIds.size} checkpoint(s) for ID: ${threadId}`,
    );
  }

  public async listSessionIds(limit = 500): Promise<string[]> {
    const pattern = 'agent:thread:*:memory';
    const results: string[] = [];
    let cursor = '0';
    do {
      const [nextCursor, keys] = await this.client.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        100,
      );
      cursor = nextCursor;
      for (const key of keys) {
        const match = key.match(/^agent:thread:(.+):memory$/);
        if (match) {
          results.push(match[1]);
          if (results.length >= limit) return results;
        }
      }
    } while (cursor !== '0');
    return results;
  }

  public async getThreadMemory(threadId: string): Promise<string | undefined> {
    const value = await this.client.get(this.getThreadMemoryKey(threadId));
    return value ?? undefined;
  }

  public async setThreadMemory(
    threadId: string,
    memory: string,
  ): Promise<void> {
    const key = this.getThreadMemoryKey(threadId);
    if (this.ttlSeconds > 0) {
      await this.client.set(key, memory, 'EX', this.ttlSeconds);
      return;
    }

    await this.client.set(key, memory);
  }

  public async getVectorMemoryIds(threadId: string): Promise<string[]> {
    const value = await this.client.get(this.getVectorIdsKey(threadId));
    if (!value) return [];
    try {
      return JSON.parse(value) as string[];
    } catch {
      return [];
    }
  }

  public async setVectorMemoryIds(
    threadId: string,
    ids: string[],
  ): Promise<void> {
    const key = this.getVectorIdsKey(threadId);
    const value = JSON.stringify(ids);
    if (this.ttlSeconds > 0) {
      await this.client.set(key, value, 'EX', this.ttlSeconds);
    } else {
      await this.client.set(key, value);
    }
  }
}
