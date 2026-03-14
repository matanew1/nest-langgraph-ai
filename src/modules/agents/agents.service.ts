import {
  Injectable,
  InternalServerErrorException,
  Logger,
  HttpException,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { createHash } from 'node:crypto';
import { RedisService } from '@redis/redis.service';
import { env } from '@config/env';
import { preview, startTimer } from '@utils/pretty-log.util';
import { agentGraph } from './graph/agent.graph';
import { AgentState } from './state/agent.state';

export interface StreamEvent {
  node: string;
  data: Record<string, unknown>;
}

const SEPARATOR = '━'.repeat(60);

@Injectable()
export class AgentsService {
  private readonly logger = new Logger(AgentsService.name);

  constructor(private readonly redisService: RedisService) {}

  private cacheKey(prompt: string): string {
    return `agent:cache:${createHash('sha256').update(prompt).digest('hex')}`;
  }

  async run(prompt: string): Promise<string> {
    const elapsed = startTimer();

    this.logger.log(`${SEPARATOR}`);
    this.logger.log(`🚀 AGENT RUN START | "${preview(prompt, 100)}"`);
    this.logger.log(SEPARATOR);

    const key = this.cacheKey(prompt);
    try {
      const cached = await this.redisService.get(key);
      if (cached) {
        this.logger.log(`Cache HIT → returning in ${elapsed()}ms`);
        return cached;
      }
      this.logger.debug('Cache MISS → running graph');
    } catch {
      this.logger.warn('Redis unavailable — skipping cache');
    }

    try {
      // Overall timeout: groq timeout × iterations × 4 LLM calls per iteration max
      const graphTimeoutMs = env.mistralTimeoutMs * env.agentMaxIterations * 4;

      let timeoutHandle: NodeJS.Timeout;
      const result = await Promise.race([
        agentGraph
          .invoke(
            { input: prompt, iteration: 0 } as Partial<AgentState>,
            {
              recursionLimit: 100,
              configurable: { thread_id: `agent-run-${Date.now()}` },
            },
          )
          .finally(() => clearTimeout(timeoutHandle)),
        new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(
            () =>
              reject(new Error(`Agent timed out after ${graphTimeoutMs}ms`)),
            graphTimeoutMs,
          );
        }),
      ]);

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

      const status = result.finalAnswer
        ? 'COMPLETE'
        : 'PARTIAL (max iterations)';
      const steps = (result.attempts ?? []).length;

      this.logger.log(SEPARATOR);
      this.logger.log(
        `🏁 AGENT RUN ${status} | ${steps} steps | ${totalTime}ms | answer=${preview(answer, 120)}`,
      );
      this.logger.log(SEPARATOR);

      try {
        await this.redisService.set(key, answer, env.cacheTtlSeconds);
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

  stream(prompt: string): Observable<{ data: string }> {
    return new Observable<{ data: string }>((subscriber) => {
      const controller = new AbortController();

      const emit = (node: string, data: Record<string, unknown>) => {
        subscriber.next({
          data: JSON.stringify({ node, data } satisfies StreamEvent),
        });
      };

      (async () => {
        try {
          const eventStream = agentGraph.streamEvents(
            { input: prompt, iteration: 0 } as Partial<AgentState>,
            { version: 'v2', signal: controller.signal },
          );
          for await (const event of eventStream) {
            if (controller.signal.aborted) break;
            if (
              event.event === 'on_chain_end' &&
              event.name &&
              event.name !== 'LangGraph'
            ) {
              emit(
                event.name,
                (event.data?.output ?? {}) as Record<string, unknown>,
              );
            }
          }
          if (!controller.signal.aborted) subscriber.complete();
        } catch (err: unknown) {
          if (controller.signal.aborted) return; // client disconnected — no-op
          const message = err instanceof Error ? err.message : String(err);
          emit('error', { message });
          subscriber.complete();
        }
      })();

      // Teardown: abort the LangGraph stream when the client disconnects
      return () => controller.abort();
    });
  }
}
