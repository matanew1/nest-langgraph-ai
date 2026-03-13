import {
  Injectable,
  InternalServerErrorException,
  Logger,
  HttpException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { redis } from '@redis/redis.provider';
import { env } from '@config/env';
import { preview } from '@utils/pretty-log.util';
import { agentGraph } from './graph/agent.graph';
import { AgentState } from './state/agent.state';

@Injectable()
export class AgentsService {
  private readonly logger = new Logger(AgentsService.name);

  private cacheKey(prompt: string): string {
    return `agent:cache:${createHash('sha256').update(prompt).digest('hex')}`;
  }

  async run(prompt: string): Promise<string> {
    this.logger.log(
      `Running agent for: "${preview(prompt, 120)}"`,
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
      const result = await agentGraph.invoke({
        input: prompt,
        iteration: 0,
      } as Partial<AgentState>);

      // Prefer finalAnswer, fall back to last tool result, then a generic message
      const answer =
        result.finalAnswer ||
        (result.toolResult
          ? `[Partial result — max iterations reached]\n\n${result.toolResult}`
          : null);

      if (!answer) {
        this.logger.warn('Agent completed without producing a final answer');
        throw new InternalServerErrorException(
          'The agent could not produce an answer. Try rephrasing your prompt.',
        );
      }

      if (!result.finalAnswer) {
        this.logger.warn('Max iterations reached — returning partial result');
      }

      try {
        await redis.set(key, answer, 'EX', env.cacheTtlSeconds);
        this.logger.debug(`Cached answer for ${env.cacheTtlSeconds}s`);
      } catch {
        this.logger.warn('Redis unavailable — skipping cache write');
      }

      return answer;
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

