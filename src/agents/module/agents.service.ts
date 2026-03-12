import {
  Injectable,
  InternalServerErrorException,
  Logger,
  HttpException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { agentGraph } from '@graph/agent.graph';
import type { AgentState } from '@state/agent.state';
import { redis } from '@providers/redis.provider';
import { env } from '@config/env';

@Injectable()
export class AgentsService {
  private readonly logger = new Logger(AgentsService.name);

  private cacheKey(prompt: string): string {
    return `agent:cache:${createHash('sha256').update(prompt).digest('hex')}`;
  }

  async *stream(prompt: string): AsyncGenerator<{ node: string; data: unknown }> {
    this.logger.log(
      `Streaming agent for: "${prompt.slice(0, 120)}${prompt.length > 120 ? '…' : ''}"`,
    );
    try {
      const streamResult = await agentGraph.stream({
        input: prompt,
        iteration: 0,
      } as Partial<AgentState>);

      for await (const chunk of streamResult) {
        for (const [node, data] of Object.entries(chunk)) {
          yield { node, data };
        }
      }
    } catch (err) {
      if (err instanceof HttpException) throw err;
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Agent stream failed: ${message}`);
      throw new InternalServerErrorException(`Agent stream failed: ${message}`);
    }
  }

  async run(prompt: string): Promise<string> {
    this.logger.log(
      `Running agent for: "${prompt.slice(0, 120)}${prompt.length > 120 ? '…' : ''}"`,
    );

    const key = this.cacheKey(prompt);
    try {
      const cached = await redis.get(key);
      if (cached) {
        this.logger.log('Cache hit — returning cached answer');
        return cached;
      }
    } catch {
      this.logger.warn('Redis unavailable — skipping cache lookup');
    }

    try {
      // LangGraph compile() returns a Runnable whose generic params don't
      // perfectly match our AgentState shape, so we use a minimal cast here.
      const result = (await agentGraph.invoke({
        input: prompt,
        iteration: 0,
      } as Partial<AgentState>)) as AgentState;

      if (!result.finalAnswer) {
        this.logger.warn('Agent completed without producing a final answer');
        throw new InternalServerErrorException(
          'The agent could not produce an answer. Try rephrasing your prompt.',
        );
      }

      try {
        await redis.set(key, result.finalAnswer, 'EX', env.cacheTtlSeconds);
        this.logger.debug(`Cached answer for ${env.cacheTtlSeconds}s`);
      } catch {
        this.logger.warn('Redis unavailable — skipping cache write');
      }

      return result.finalAnswer;
    } catch (err) {
      if (err instanceof HttpException) throw err;
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Agent graph execution failed: ${message}`);
      throw new InternalServerErrorException(
        `Agent execution failed: ${message}`,
      );
    }
  }
}
