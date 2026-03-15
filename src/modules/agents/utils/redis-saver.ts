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
    const decoded = typeof data === 'string' 
      ? data 
      : new TextDecoder().decode(data);
    
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

    this.logger.log(`📥 Loaded checkpoint for thread "${threadId}" (id: ${checkpointId})`);

    // Use the async loadsTyped with the 'json' type
    const checkpoint = (await this.serde.loadsTyped(
      'json',
      checkpointData,
    )) as Checkpoint;
    
    const metadata = metadataData
      ? ((await this.serde.loadsTyped('json', metadataData)) as CheckpointMetadata)
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
    // Check if thread exists by looking up the thread key
    const threadKey = this.getThreadKey(threadId);
    const threadExists = await this.client.exists(threadKey);

    if (!threadExists) throw new NotFoundException('Thread ID not found');

    // Get the latest checkpoint ID for the thread and delete associated keys
    const latestId = await this.client.get(threadKey);
    
    if (latestId) {
      // Delete the checkpoint and metadata keys associated with the latest checkpoint ID
      await this.client.del(this.getCheckpointKey(latestId));
      // It's possible that metadata might not exist if the checkpoint was never saved, so we can ignore errors here
      await this.client.del(this.getMetadataKey(latestId));
    }

    await this.client.del(this.getThreadKey(threadId));
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

    // Get the serialized [type, bytes] from dumpsTyped
    const [, checkpointBytes] = await this.serde.dumpsTyped(checkpoint);
    const [, metadataBytes] = await this.serde.dumpsTyped(metadata);

    const pipeline = this.client.pipeline();
    if (this.ttlSeconds > 0) {
      pipeline.set(checkpointKey, checkpointBytes as any, 'EX', this.ttlSeconds);
      pipeline.set(metadataKey, metadataBytes as any, 'EX', this.ttlSeconds);
      pipeline.set(threadKey, checkpoint.id, 'EX', this.ttlSeconds);
    } else {
      pipeline.set(checkpointKey, checkpointBytes as any);
      pipeline.set(metadataKey, metadataBytes as any);
      pipeline.set(threadKey, checkpoint.id);
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