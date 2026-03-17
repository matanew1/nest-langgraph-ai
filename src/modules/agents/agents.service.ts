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
      recursionLimit: 200,
    };

    try {
      const graphTimeoutMs =
        env.mistralTimeoutMs * env.agentMaxIterations * 4 || 120000;
      const previous = sessionId
        ? await this._tryLoadPreviousState(threadId)
        : undefined;
      const initialState = this._createInitialState(prompt, previous);

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
      recursionLimit: 200,
    };

    const previous = sessionId
      ? await this._tryLoadPreviousState(threadId)
      : undefined;
    const initialState = this._createInitialState(prompt, previous);

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
        if (stateSnapshot.phase === 'execute') {
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
      const finalAnswer = finalState.values.finalAnswer;
      if (
        (finalState.values.phase === 'complete' ||
          finalState.values.phase === 'fatal') &&
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
            finalState.values.finalAnswer ||
            finalState.values.toolResult?.preview ||
            finalState.values.toolResultRaw ||
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

  /**
   * Load the latest checkpointed state for a thread, if any.
   *
   * This is essential for session continuity: LangGraph can resume from a
   * prior checkpoint, but we must avoid overwriting restored values with a
   * fully "blank" initial state.
   */
  private async _tryLoadPreviousState(
    threadId: string,
  ): Promise<Partial<AgentState> | undefined> {
    try {
      const state = await this.app.getState({
        configurable: { thread_id: threadId },
      });
      return (state?.values ?? undefined) as Partial<AgentState> | undefined;
    } catch {
      return undefined;
    }
  }

  private _createInitialState(
    prompt: string,
    previous?: Partial<AgentState>,
  ): Partial<AgentState> {
    return {
      // Always replace the user input for the new turn.
      input: prompt,
      // Always restart the workflow at supervisor for a new user prompt.
      phase: 'supervisor',

      // Reset per-run fields so we don't execute a prior plan/tool selection.
      currentStep: 0,
      plan: [],
      objective: undefined,
      expectedResult: undefined,
      selectedTool: undefined,
      toolParams: undefined,
      toolResultRaw: undefined,
      toolResult: undefined,
      criticDecision: undefined,
      jsonRepair: undefined,
      jsonRepairResult: undefined,
      finalAnswer: undefined,

      // Preserve long-lived context where helpful for better responses.
      projectContext: previous?.projectContext,
      attempts: previous?.attempts ?? [],

      // Always reset loop counters/errors for this new prompt.
      counters: { turn: 0, toolCalls: 0, replans: 0, stepRetries: 0 },
      errors: [],
    };
  }
}
