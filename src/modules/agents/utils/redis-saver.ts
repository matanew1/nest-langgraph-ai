import {
  BaseCheckpointSaver,
  Checkpoint,
  CheckpointTuple,
  CheckpointMetadata,
  CheckpointListOptions,
  SerializerProtocol,
} from '@langchain/langgraph-checkpoint';
import { RunnableConfig } from '@langchain/core/runnables';
import { Redis } from 'ioredis';
import { env } from '@config/env';
import { Logger, NotFoundException } from '@nestjs/common';
import { Buffer } from 'buffer';

/**
 * Modern LangGraph Serde protocol requires:
 * 1. dumpsTyped returns Promise<[contentType, data]> (contentType is 'json' or 'text')
 * 2. loadsTyped takes (contentType, data) and returns Promise<any> (data is a string or Uint8Array)
 */
class DefaultSerializer implements SerializerProtocol {
  dumpsTyped(obj: any): Promise<[string, Uint8Array]> {
    const data = new TextEncoder().encode(JSON.stringify(obj));
    return Promise.resolve(['json', data]);
  }

  loadsTyped(_type: string, data: string | Uint8Array): Promise<any> {
    const decoded =
      typeof data === 'string' ? data : new TextDecoder().decode(data);

    return Promise.resolve(JSON.parse(decoded));
  }
}

export class RedisSaver extends BaseCheckpointSaver {
  private client: Redis;
  private readonly logger = new Logger(RedisSaver.name);
  private readonly ttlSeconds: number;
  private readonly historyLimit: number = 25;

  constructor(redisClient: Redis) {
    super(new DefaultSerializer());
    this.client = redisClient;
    this.ttlSeconds = env.sessionTtlSeconds;
  }

  /**
   * Backwards-compatible keys:
   * - agent:thread:<id> => latest checkpoint id (string)
   * - agent:checkpoint:<checkpointId> => serialized Checkpoint
   * - agent:checkpoint_metadata:<checkpointId> => serialized CheckpointMetadata
   * - agent:thread:<id>:checkpoints => SET of checkpoint ids
   *
   * New keys (simplified):
   * - agent:thread:<id>:latest => latest checkpoint id (string)
   * - agent:thread:<id>:history => ZSET of checkpoint ids (score=ms timestamp)
   * - agent:checkpoint_record:<checkpointId> => serialized { checkpoint, metadata }
   * - agent:thread:<id>:memory => optional string summary (future session memory)
   */

  private getLegacyThreadKey(threadId: string): string {
    return `agent:thread:${threadId}`;
  }

  private getThreadLatestKey(threadId: string): string {
    return `agent:thread:${threadId}:latest`;
  }

  private getThreadHistoryKey(threadId: string): string {
    return `agent:thread:${threadId}:history`;
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

  private getThreadCheckpointsKey(threadId: string): string {
    return `agent:thread:${threadId}:checkpoints`;
  }

  private getThreadMemoryKey(threadId: string): string {
    return `agent:thread:${threadId}:memory`;
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const threadId = config.configurable?.thread_id;
    if (!threadId) {
      throw new Error('Thread ID is not configured.');
    }

    let checkpointId = config.configurable?.checkpoint_id;
    if (!checkpointId) {
      checkpointId =
        (await this.client.get(this.getThreadLatestKey(threadId))) ??
        (await this.client.get(this.getLegacyThreadKey(threadId)));
    }

    if (!checkpointId) return undefined;

    // Prefer the new combined record key (one Redis read for both checkpoint + metadata).
    const recordData = await this.client.getBuffer(
      this.getCheckpointRecordKey(checkpointId),
    );

    if (recordData) {
      this.logger.log(
        `📥 Loaded checkpoint for thread "${threadId}" (id: ${checkpointId})`,
      );

      const record = (await this.serde.loadsTyped('json', recordData)) as {
        checkpoint: Checkpoint;
        metadata?: CheckpointMetadata;
      };

      return {
        config: {
          configurable: { thread_id: threadId, checkpoint_id: checkpointId },
        },
        checkpoint: record.checkpoint,
        metadata: (record.metadata ?? {}) as CheckpointMetadata,
        pendingWrites: [],
      };
    }

    // Backwards-compat fallback (older deployments stored checkpoint + metadata separately).
    const [checkpointData, metadataData] = await Promise.all([
      this.client.getBuffer(this.getCheckpointKey(checkpointId)),
      this.client.getBuffer(this.getMetadataKey(checkpointId)),
    ]);

    if (!checkpointData) return undefined;

    this.logger.log(
      `📥 Loaded checkpoint for thread "${threadId}" (id: ${checkpointId})`,
    );

    // Use the async loadsTyped with the 'json' type
    const checkpoint = (await this.serde.loadsTyped(
      'json',
      checkpointData,
    )) as Checkpoint;

    const metadata = metadataData
      ? ((await this.serde.loadsTyped(
          'json',
          metadataData,
        )) as CheckpointMetadata)
      : ({} as CheckpointMetadata);

    return {
      config: {
        configurable: { thread_id: threadId, checkpoint_id: checkpointId },
      },
      checkpoint,
      metadata,
      pendingWrites: [],
    };
  }

  async *list(
    config: RunnableConfig,
    _options?: CheckpointListOptions,
  ): AsyncGenerator<CheckpointTuple> {
    const threadId = config.configurable?.thread_id;
    if (!threadId) return;

    const historyKey = this.getThreadHistoryKey(threadId);
    const checkpointIds = await this.client.zrevrange(historyKey, 0, -1);

    for (const checkpointId of checkpointIds) {
      const recordData = await this.client.getBuffer(
        this.getCheckpointRecordKey(checkpointId),
      );

      if (recordData) {
        const record = (await this.serde.loadsTyped('json', recordData)) as {
          checkpoint: Checkpoint;
          metadata?: CheckpointMetadata;
        };

        yield {
          config: {
            configurable: { thread_id: threadId, checkpoint_id: checkpointId },
          },
          checkpoint: record.checkpoint,
          metadata: (record.metadata ?? {}) as CheckpointMetadata,
          pendingWrites: [],
        };
        continue;
      }

      // Backwards-compat fallback
      const [checkpointData, metadataData] = await Promise.all([
        this.client.getBuffer(this.getCheckpointKey(checkpointId)),
        this.client.getBuffer(this.getMetadataKey(checkpointId)),
      ]);

      if (!checkpointData) continue;

      const checkpoint = (await this.serde.loadsTyped(
        'json',
        checkpointData,
      )) as Checkpoint;

      const metadata = metadataData
        ? ((await this.serde.loadsTyped(
            'json',
            metadataData,
          )) as CheckpointMetadata)
        : ({} as CheckpointMetadata);

      yield {
        config: {
          configurable: { thread_id: threadId, checkpoint_id: checkpointId },
        },
        checkpoint,
        metadata,
        pendingWrites: [],
      };
    }
  }

  public async deleteThread(threadId: string): Promise<void> {
    const legacySetKey = this.getThreadCheckpointsKey(threadId);
    const historyKey = this.getThreadHistoryKey(threadId);

    const [historyIds, legacyIds] = await Promise.all([
      this.client.zrange(historyKey, 0, -1),
      this.client.smembers(legacySetKey),
    ]);

    const checkpointIds = [...new Set([...historyIds, ...legacyIds])];

    // For backward compatibility, check the old thread key if the set is empty
    if (checkpointIds.length === 0) {
      const latestId =
        (await this.client.get(this.getThreadLatestKey(threadId))) ??
        (await this.client.get(this.getLegacyThreadKey(threadId)));
      if (latestId) {
        checkpointIds.push(latestId);
      }
    }

    if (checkpointIds.length === 0) {
      throw new NotFoundException(
        `Thread ID "${threadId}" not found or has no associated checkpoints.`,
      );
    }

    const pipeline = this.client.pipeline();

    for (const checkpointId of checkpointIds) {
      pipeline.del(this.getCheckpointRecordKey(checkpointId));
      pipeline.del(this.getCheckpointKey(checkpointId));
      pipeline.del(this.getMetadataKey(checkpointId));
    }

    pipeline.del(this.getThreadLatestKey(threadId));
    pipeline.del(this.getLegacyThreadKey(threadId));
    pipeline.del(historyKey);
    pipeline.del(legacySetKey);
    pipeline.del(this.getThreadMemoryKey(threadId));
    await pipeline.exec();

    this.logger.log(
      `🗑️ Deleted session state and ${checkpointIds.length} checkpoint(s) for ID: ${threadId}`,
    );
  }
  public putWrites(
    _config: RunnableConfig,
    _writes: Array<[string, any]>,
    _taskId: string,
  ): Promise<void> {
    void _config;
    void _writes;
    void _taskId;
    return Promise.resolve();
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
  ): Promise<RunnableConfig> {
    const threadId = config.configurable?.thread_id;
    if (!threadId) throw new Error('Thread ID missing');

    const latestKey = this.getThreadLatestKey(threadId);
    const historyKey = this.getThreadHistoryKey(threadId);
    const recordKey = this.getCheckpointRecordKey(checkpoint.id);
    const legacyThreadKey = this.getLegacyThreadKey(threadId);
    const legacySetKey = this.getThreadCheckpointsKey(threadId);

    // Store as a single combined record (simpler and fewer redis operations on read).
    const record = { checkpoint, metadata };
    const [, recordBytes] = await this.serde.dumpsTyped(record);

    const pipeline = this.client.pipeline();
    if (this.ttlSeconds > 0) {
      pipeline.set(
        recordKey,
        Buffer.from(recordBytes as any),
        'EX',
        this.ttlSeconds,
      );
      pipeline.set(latestKey, checkpoint.id, 'EX', this.ttlSeconds);
      pipeline.zadd(historyKey, Date.now(), checkpoint.id);
      pipeline.expire(historyKey, this.ttlSeconds);

      // Keep legacy pointers in-sync for backward compatibility.
      pipeline.set(legacyThreadKey, checkpoint.id, 'EX', this.ttlSeconds);
      pipeline.sadd(legacySetKey, checkpoint.id);
      pipeline.expire(legacySetKey, this.ttlSeconds);
    } else {
      pipeline.set(recordKey, Buffer.from(recordBytes as any));
      pipeline.set(latestKey, checkpoint.id);
      pipeline.zadd(historyKey, Date.now(), checkpoint.id);

      pipeline.set(legacyThreadKey, checkpoint.id);
      pipeline.sadd(legacySetKey, checkpoint.id);
    }

    // Bound the per-thread history to avoid unbounded growth.
    pipeline.zremrangebyrank(historyKey, 0, -(this.historyLimit + 1));

    await pipeline.exec();

    return {
      configurable: {
        thread_id: threadId,
        checkpoint_id: checkpoint.id,
      },
    };
  }

  /**
   * Optional "session memory" helper (not required by LangGraph).
   * Can be used to store a compact summary across user turns.
   */
  public async getThreadMemory(threadId: string): Promise<string | undefined> {
    const v = await this.client.get(this.getThreadMemoryKey(threadId));
    return v ?? undefined;
  }

  public async setThreadMemory(
    threadId: string,
    memory: string,
  ): Promise<void> {
    const key = this.getThreadMemoryKey(threadId);
    if (this.ttlSeconds > 0) {
      await this.client.set(key, memory, 'EX', this.ttlSeconds);
    } else {
      await this.client.set(key, memory);
    }
  }
}
