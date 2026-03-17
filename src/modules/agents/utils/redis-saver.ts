import {
  BaseCheckpointSaver,
  Checkpoint,
  CheckpointTuple,
  CheckpointMetadata,
  SerializerProtocol,
} from '@langchain/langgraph-checkpoint';
import { RunnableConfig } from '@langchain/core/runnables';
import { Redis } from 'ioredis';
import { env } from '@config/env';
import { Logger, NotFoundException } from '@nestjs/common';
import { Buffer } from 'buffer';

/**
 * Modern LangGraph Serde protocol requires:
 * 1. dumpsTyped returns Promise<[contentType, data]>
 * 2. loadsTyped takes (contentType, data) and returns Promise<any>
 */
class DefaultSerializer implements SerializerProtocol {
  async dumpsTyped(obj: any): Promise<[string, Uint8Array]> {
    const data = new TextEncoder().encode(JSON.stringify(obj));
    return ['json', data];
  }

  async loadsTyped(_type: string, data: string | Uint8Array): Promise<any> {
    const decoded =
      typeof data === 'string' ? data : new TextDecoder().decode(data);

    return JSON.parse(decoded);
  }
}

export class RedisSaver extends BaseCheckpointSaver {
  private client: Redis;
  private readonly logger = new Logger(RedisSaver.name);
  private readonly ttlSeconds: number;

  constructor(redisClient: Redis) {
    super(new DefaultSerializer());
    this.client = redisClient;
    this.ttlSeconds = env.cacheTtlSeconds;
  }

  private getThreadKey(threadId: string): string {
    return `agent:thread:${threadId}`;
  }

  private getCheckpointKey(checkpointId: string): string {
    return `agent:checkpoint:${checkpointId}`;
  }

  private getMetadataKey(checkpointId: string): string {
    return `agent:checkpoint_metadata:${checkpointId}`;
  }

  private getThreadCheckpointsKey(threadId: string): string {
    return `agent:thread:${threadId}:checkpoints`;
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const threadId = config.configurable?.thread_id;
    if (!threadId) {
      throw new Error('Thread ID is not configured.');
    }

    let checkpointId = config.configurable?.checkpoint_id;
    if (!checkpointId) {
      checkpointId = await this.client.get(this.getThreadKey(threadId));
    }

    if (!checkpointId) return undefined;

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

  async *list(): AsyncGenerator<CheckpointTuple> {
    yield* [];
  }

  public async deleteThread(threadId: string): Promise<void> {
    const threadCheckpointsKey = this.getThreadCheckpointsKey(threadId);
    const checkpointIds = await this.client.smembers(threadCheckpointsKey);

    // For backward compatibility, check the old thread key if the set is empty
    if (checkpointIds.length === 0) {
      const latestId = await this.client.get(this.getThreadKey(threadId));
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
      pipeline.del(this.getCheckpointKey(checkpointId));
      pipeline.del(this.getMetadataKey(checkpointId));
    }

    pipeline.del(this.getThreadKey(threadId));
    pipeline.del(threadCheckpointsKey);
    await pipeline.exec();

    this.logger.log(
      `🗑️ Deleted session state and ${checkpointIds.length} checkpoint(s) for ID: ${threadId}`,
    );
  }
  public async putWrites(
    _config: RunnableConfig,
    _writes: Array<[string, any]>,
    _taskId: string,
  ): Promise<void> {}

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
  ): Promise<RunnableConfig> {
    const threadId = config.configurable?.thread_id;
    if (!threadId) throw new Error('Thread ID missing');

    const threadKey = this.getThreadKey(threadId);
    const checkpointKey = this.getCheckpointKey(checkpoint.id);
    const metadataKey = this.getMetadataKey(checkpoint.id);
    const threadCheckpointsKey = this.getThreadCheckpointsKey(threadId);

    // Get the serialized [type, bytes] from dumpsTyped
    const [, checkpointBytes] = await this.serde.dumpsTyped(checkpoint);
    const [, metadataBytes] = await this.serde.dumpsTyped(metadata);

    const pipeline = this.client.pipeline();
    if (this.ttlSeconds > 0) {
      pipeline.set(
        checkpointKey,
        Buffer.from(checkpointBytes as any),
        'EX',
        this.ttlSeconds,
      );
      pipeline.set(
        metadataKey,
        Buffer.from(metadataBytes as any),
        'EX',
        this.ttlSeconds,
      );
      pipeline.set(threadKey, checkpoint.id, 'EX', this.ttlSeconds);
      pipeline.sadd(threadCheckpointsKey, checkpoint.id);
      pipeline.expire(threadCheckpointsKey, this.ttlSeconds);
    } else {
      pipeline.set(checkpointKey, Buffer.from(checkpointBytes as any));
      pipeline.set(metadataKey, Buffer.from(metadataBytes as any));
      pipeline.set(threadKey, checkpoint.id);
      pipeline.sadd(threadCheckpointsKey, checkpoint.id);
    }
    await pipeline.exec();

    return {
      configurable: {
        thread_id: threadId,
        checkpoint_id: checkpoint.id,
      },
    };
  }
}
