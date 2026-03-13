import {
  Injectable,
  InternalServerErrorException,
  Logger,
  HttpException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { redis } from '@redis/redis.provider';
import { env } from '@config/env';
import { preview, startTimer } from '@utils/pretty-log.util';
import { agentGraph } from './graph/agent.graph';
import { AgentState } from './state/agent.state';

const SEPARATOR = '━'.repeat(60);

@Injectable()
export class AgentsService {
  private readonly logger = new Logger(AgentsService.name);

  private cacheKey(prompt: string): string {
    return `agent:cache:${createHash('sha256').update(prompt).digest('hex')}`;
  }

  async run(prompt: string): Promise<string> {
    const elapsed = startTimer();

    this.logger.log(`\n${SEPARATOR}`);
    this.logger.log(`🚀 AGENT RUN START | "${preview(prompt, 100)}"`);
    this.logger.log(SEPARATOR);

    const key = this.cacheKey(prompt);
    try {
      const cached = await redis.get(key);
      if (cached) {
        this.logger.log(`Cache HIT → returning in ${elapsed()}ms`);
        return cached;
      }
      this.logger.debug('Cache MISS → running graph');
    } catch {
      this.logger.warn('Redis unavailable — skipping cache');
    }

    try {
      const result = await agentGraph.invoke({
        input: prompt,
        iteration: 0,
      } as Partial<AgentState>);

      const totalTime = elapsed();

      // Prefer finalAnswer, fall back to last tool result, then a generic message
      const answer =
        result.finalAnswer ||
        (result.toolResult
          ? `[Partial result — max iterations reached]\n\n${result.toolResult}`
          : null);

      if (!answer) {
        this.logger.warn('Agent completed without a final answer');
        throw new InternalServerErrorException(
          'The agent could not produce an answer. Try rephrasing your prompt.',
        );
      }

      const status = result.finalAnswer ? 'COMPLETE' : 'PARTIAL (max iterations)';
      const steps = (result.attempts ?? []).length;

      this.logger.log(SEPARATOR);
      this.logger.log(
        `🏁 AGENT RUN ${status} | ${steps} steps | ${totalTime}ms | answer=${preview(answer, 120)}`,
      );
      this.logger.log(SEPARATOR);

      try {
        await redis.set(key, answer, 'EX', env.cacheTtlSeconds);
      } catch {
        this.logger.warn('Redis unavailable — skipping cache write');
      }

      return answer;
    } catch (err) {
      if (err instanceof HttpException) throw err;
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Agent execution failed in ${elapsed()}ms: ${message}`);
      throw new InternalServerErrorException(
        `Agent execution failed: ${message}`,
      );
    }
  }
}
