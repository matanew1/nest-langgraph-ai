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
import { RedisSaver } from './utils/redis-saver';
import type { StreamEventDto } from './agents.dto';

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

    this.logger.log(`${SEPARATOR}`);
    this.logger.log(
      `🚀 AGENT RUN START | Session: ${threadId} | Prompt: "${preview(prompt)}"`,
    );
    this.logger.log(SEPARATOR);

    const config = {
      configurable: {
        thread_id: threadId,
      },
      recursionLimit: 100,
    };

    try {
      const graphTimeoutMs =
        env.mistralTimeoutMs * env.agentMaxIterations * 4 || 120000;
      const initialState = this._createInitialState(prompt);

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

      const answer = result.finalAnswer || result.toolResult;

      if (!answer) {
        this.logger.warn('Agent completed without a final answer');
        throw new InternalServerErrorException(
          'The agent could not produce an answer. Try rephrasing your prompt.',
        );
      }

      const status = result.finalAnswer ? 'COMPLETE' : 'PARTIAL';
      const steps = Array.isArray(result.attempts) ? result.attempts.length : 0;

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
      recursionLimit: 25,
    };

    const initialState = this._createInitialState(prompt);

    try {
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
        if (stateSnapshot.status === 'running') {
          yield {
            type: 'step',
            data: `Executing step ${stateSnapshot.currentStep}: ${stateSnapshot.selectedTool || node}`,
            sessionId: threadId,
            step: stateSnapshot.currentStep as number,
            done: false,
          };
        } else if (stateSnapshot.toolResult) {
          yield {
            type: 'chunk',
            data: preview(stateSnapshot.toolResult, 200),
            sessionId: threadId,
            done: false,
          };
        }
      }

      // Single final yield only if properly completed
      const finalState = await this.app.getState({
        configurable: { thread_id: threadId },
      });
      const finalAnswer = finalState.values.finalAnswer;
      if (finalState.values.done && finalAnswer) {
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
            finalState.values.finalAnswer ||
            finalState.values.toolResult ||
            'Task ended without proper final answer.',
          sessionId: threadId,
          done: true,
        };
      }

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

  private _createInitialState(prompt: string): Partial<AgentState> {
    return {
      input: prompt,
      iteration: 0,
      status: 'plan_required',
      currentStep: 0,
      plan: [],
      finalAnswer: undefined,
      toolResult: undefined,
      done: false,
      consecutiveRetries: 0,
    };
  }
}
