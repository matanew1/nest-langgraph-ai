import {
  Injectable,
  InternalServerErrorException,
  Logger,
  HttpException,
  Inject,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '@redis/redis.constants';
import { env } from '@config/env';
import { preview, startTimer } from '@utils/pretty-log.util';
import { agentWorkflow } from './graph/agent.graph';
import { AgentState } from './state/agent.state';
import { AGENT_PHASES } from './state/agent-phase';
import { createInitialAgentRunState } from './state/agent-run-state.util';
import { RedisSaver } from './utils/redis-saver';
import type { StreamEventDto } from './agents.dto';
import * as crypto from 'crypto';

export interface AgentRunResult {
  result: string;
  sessionId: string;
}

const SEPARATOR = '━'.repeat(60);

export type StreamEvent = StreamEventDto;

@Injectable()
export class AgentsService {
  private readonly logger = new Logger(AgentsService.name);
  private checkpointer: RedisSaver;

  private app: ReturnType<typeof agentWorkflow.compile>;

  constructor(@Inject(REDIS_CLIENT) private readonly redisClient: Redis) {
    this.checkpointer = new RedisSaver(this.redisClient);
    this.app = agentWorkflow.compile({
      checkpointer: this.checkpointer as any,
    });
  }

  async run(prompt: string, sessionId?: string): Promise<AgentRunResult> {
    const elapsed = startTimer();
    const threadId = sessionId || uuidv4();
    const cacheKey = this._getCacheKey(prompt);

    this.logger.log(`${SEPARATOR}`);
    this.logger.log(
      `🚀 AGENT RUN START | Session: ${threadId} | Prompt: "${preview(prompt)}"`,
    );
    this.logger.log(SEPARATOR);

    const config = {
      configurable: {
        thread_id: threadId,
      },
      recursionLimit: 200,
    };

    try {
      // Check cache before invoking the graph, but keep Redis errors inside the
      // request-level error handling path.
      const cachedResult = await this.redisClient.get(cacheKey);
      if (cachedResult) {
        this.logger.log(`🚀 AGENT RUN CACHE HIT | Prompt: "${preview(prompt)}"`);
        return { result: cachedResult, sessionId: threadId };
      }

      const graphTimeoutMs =
        env.mistralTimeoutMs * env.agentMaxIterations * 4 || 120000;
      const sessionMemory = await this._tryLoadSessionMemory(threadId);
      const initialState = createInitialAgentRunState(prompt, {
        sessionMemory,
      });

      let timeoutHandle: any;
      const result: any = await Promise.race([
        this.app
          .invoke(initialState as any, config)
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

      const answer =
        result.finalAnswer ||
        result.toolResult?.preview ||
        result.toolResultRaw ||
        undefined;

      if (!answer) {
        this.logger.warn('Agent completed without a final answer');
        throw new InternalServerErrorException(
          'The agent could not produce an answer. Try rephrasing your prompt.',
        );
      }

      // Cache the result
      await this.redisClient.setex(cacheKey, env.cacheTtlSeconds, answer);

      const status = result.finalAnswer ? 'COMPLETE' : 'PARTIAL';
      const steps = Array.isArray(result.attempts) ? result.attempts.length : 0;

      await this._persistSessionMemory(threadId, prompt, result, sessionMemory);

      this.logger.log(SEPARATOR);
      this.logger.log(
        `🏁 AGENT RUN ${status} | ${steps} steps | ${totalTime}ms | answer=${preview(answer)}`,
      );
      this.logger.log(SEPARATOR);

      return { result: answer, sessionId: threadId };
    } catch (err) {
      if (err instanceof HttpException) throw err;
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Agent execution failed in ${elapsed()}ms: ${message}`);
      throw new InternalServerErrorException(
        `Agent execution failed: ${message}`,
      );
    }
  }

  async *streamRun(
    prompt: string,
    sessionId?: string,
  ): AsyncGenerator<StreamEvent> {
    const elapsed = startTimer();
    const threadId = sessionId || uuidv4();

    this.logger.log(`${SEPARATOR}`);
    this.logger.log(
      `🚀 AGENT STREAM START | Session: ${threadId} | Prompt: "${preview(prompt)}"`,
    );
    this.logger.log(SEPARATOR);

    const config = {
      configurable: {
        thread_id: threadId,
      },
      recursionLimit: 200,
    };

    try {
      const sessionMemory = await this._tryLoadSessionMemory(threadId);
      const initialState = createInitialAgentRunState(prompt, {
        sessionMemory,
      });

      yield {
        type: 'step',
        data: `Starting agent execution...`,
        sessionId: threadId,
        step: 0,
        done: false,
      };

      const stream = await this.app.stream(initialState as any, config);
      for await (const event of stream) {
        const node = Object.keys(event)[0];
        const stateSnapshot = (event as any)[node] as Partial<AgentState>;

        // Stream step/chunk updates (no early final)
        if (stateSnapshot.phase === AGENT_PHASES.EXECUTE) {
          yield {
            type: 'step',
            data: `Executing step ${stateSnapshot.currentStep}: ${stateSnapshot.selectedTool || node}`,
            sessionId: threadId,
            step: stateSnapshot.currentStep as number,
            done: false,
          };
        } else if (stateSnapshot.toolResultRaw) {
          yield {
            type: 'chunk',
            data: preview(stateSnapshot.toolResultRaw, 200),
            sessionId: threadId,
            done: false,
          };
        }
      }

      // Single final yield only if properly completed
      const finalState = await this.app.getState({
        configurable: { thread_id: threadId },
      });
      const finalValues = finalState.values as Partial<AgentState>;
      const finalAnswer = finalValues.finalAnswer;
      if (
        (finalValues.phase === AGENT_PHASES.COMPLETE ||
          finalValues.phase === AGENT_PHASES.FATAL) &&
        finalAnswer
      ) {
        yield {
          type: 'final',
          data: finalAnswer,
          sessionId: threadId,
          done: true,
        };
      } else {
        yield {
          type: 'error',
          data:
            finalValues.finalAnswer ||
            finalValues.toolResult?.preview ||
            finalValues.toolResultRaw ||
            'Task ended without proper final answer.',
          sessionId: threadId,
          done: true,
        };
      }

      await this._persistSessionMemory(
        threadId,
        prompt,
        finalValues,
        sessionMemory,
      );

      const totalTime = elapsed();
      this.logger.log(`🏁 AGENT STREAM COMPLETE | ${totalTime}ms`);
    } catch (err: any) {
      const message = err.message || String(err);
      this.logger.error(`Agent stream failed: ${message}`);
      yield {
        type: 'error',
        data: `Stream failed: ${message}`,
        sessionId: threadId,
        done: true,
      };
      throw new InternalServerErrorException(`Stream failed: ${message}`);
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.logger.log(`🗑️ Deleting session state for ID: ${sessionId}`);
    return this.checkpointer.deleteThread(sessionId);
  }

  private _getCacheKey(prompt: string): string {
    const hash = crypto.createHash('sha256').update(prompt).digest('hex');
    return `agent:cache:${hash}`;
  }

  private async _tryLoadSessionMemory(
    threadId: string,
  ): Promise<string | undefined> {
    try {
      return await this.checkpointer.getThreadMemory(threadId);
    } catch {
      return undefined;
    }
  }

  private async _persistSessionMemory(
    threadId: string,
    prompt: string,
    result: Partial<AgentState>,
    previousMemory?: string,
  ): Promise<void> {
    const entry = this._buildSessionMemoryEntry(prompt, result);
    if (!entry) return;

    const merged = this._mergeSessionMemory(previousMemory, entry);

    try {
      await this.checkpointer.setThreadMemory(threadId, merged);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to persist session memory: ${message}`);
    }
  }

  private _buildSessionMemoryEntry(
    prompt: string,
    result: Partial<AgentState>,
  ): string | undefined {
    const objective = (result.objective ?? prompt).trim();
    const answer =
      result.finalAnswer ??
      result.toolResult?.preview ??
      result.toolResultRaw ??
      undefined;

    if (!objective || !answer) return undefined;

    return [
      `[${new Date().toISOString()}]`,
      `Objective: ${preview(objective, 160)}`,
      `Outcome: ${preview(answer, 280)}`,
    ].join('\n');
  }

  private _mergeSessionMemory(
    previousMemory: string | undefined,
    entry: string,
  ): string {
    const existingEntries = previousMemory
      ? previousMemory
          .split('\n---\n')
          .map((part) => part.trim())
          .filter(Boolean)
      : [];

    const merged = [entry, ...existingEntries.filter((item) => item !== entry)]
      .slice(0, 3)
      .join('\n---\n');

    const maxChars = Math.max(env.promptMaxSummaryChars, 1200);
    return merged.length <= maxChars ? merged : merged.slice(0, maxChars);
  }
}
