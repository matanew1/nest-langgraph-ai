import {
  Injectable,
  InternalServerErrorException,
  BadRequestException,
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
import type { PlanStep } from './state/agent.state';
import { AGENT_PHASES } from './state/agent-phase';
import { createInitialAgentRunState } from './state/agent-run-state.util';
import {
  beginExecutionStep,
  failAgentRun,
  transitionToPhase,
} from './state/agent-transition.util';
import { upsertVectorMemory } from '../vector-db/vector-memory.util';
import { RedisSaver } from './utils/redis-saver';
import type { StreamEventDto } from './agents.dto';
import * as crypto from 'crypto';

export interface AgentRunResult {
  result: string;
  sessionId: string;
}

export interface ReviewPageData {
  sessionId: string;
  objective: string;
  plan: PlanStep[];
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
      const sessionMemory = await this._tryLoadSessionMemory(threadId);
      const cacheKey = await this._buildCacheKey(
        prompt,
        threadId,
        sessionMemory,
      );

      // Check cache before invoking the graph, but keep Redis errors inside the
      // request-level error handling path.
      const cachedResult = await this.redisClient.get(cacheKey);
      if (cachedResult) {
        this.logger.log(
          `🚀 AGENT RUN CACHE HIT | Prompt: "${preview(prompt)}"`,
        );
        return { result: cachedResult, sessionId: threadId };
      }

      const graphTimeoutMs =
        env.mistralTimeoutMs * env.agentMaxIterations * 4 || 120000;
      const initialState = createInitialAgentRunState(prompt, {
        sessionMemory,
        sessionId: threadId,
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

      if (result.phase === AGENT_PHASES.COMPLETE) {
        void this._autoUpsertVectorMemory(
          prompt,
          result,
          await this._getRepoFingerprint(),
        );
      }

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
        sessionId: threadId,
      });

      yield {
        type: 'status',
        data: `Starting agent execution...`,
        sessionId: threadId,
        done: false,
      };

      const stream = await this.app.stream(initialState as any, config);
      for await (const event of stream) {
        const node = Object.keys(event)[0];
        const snap = event[node] as Partial<AgentState>;

        if (snap.phase === AGENT_PHASES.EXECUTE && snap.selectedTool) {
          yield {
            type: 'tool_call_started',
            data: `${snap.selectedTool} (step ${snap.currentStep})`,
            sessionId: threadId,
            step: snap.currentStep as number,
            done: false,
          };
        } else if (snap.phase === AGENT_PHASES.NORMALIZE_TOOL_RESULT) {
          yield {
            type: 'tool_call_finished',
            data: preview(snap.toolResultRaw ?? '', 200),
            sessionId: threadId,
            done: false,
          };
        } else if (
          snap.phase === AGENT_PHASES.PLAN &&
          (snap as any).plan?.length
        ) {
          yield {
            type: 'plan',
            data: JSON.stringify((snap as any).plan),
            sessionId: threadId,
            done: false,
          };
        } else if (
          snap.phase === AGENT_PHASES.AWAIT_PLAN_REVIEW &&
          (snap as any).reviewRequest
        ) {
          yield {
            type: 'review_required',
            data: JSON.stringify((snap as any).reviewRequest),
            sessionId: threadId,
            done: false,
          };
        } else {
          // Only surface phases that are meaningful to the end user.
          // Skip internal routing/bookkeeping phases (route, complete, fatal,
          // normalize_tool_result, judge, clarification, etc.).
          const USER_VISIBLE_PHASES = new Set([
            AGENT_PHASES.SUPERVISOR,
            AGENT_PHASES.RESEARCH,
            AGENT_PHASES.VALIDATE_PLAN,
            AGENT_PHASES.GENERATE,
            AGENT_PHASES.CHAT,
            AGENT_PHASES.FATAL_RECOVERY,
          ]);
          if (snap.phase && USER_VISIBLE_PHASES.has(snap.phase as any)) {
            yield {
              type: 'status',
              data: `Phase: ${snap.phase}`,
              sessionId: threadId,
              done: false,
            };
          }
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

      if (finalValues.phase === AGENT_PHASES.COMPLETE) {
        void this._autoUpsertVectorMemory(
          prompt,
          finalValues,
          await this._getRepoFingerprint(),
        );
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
      // Do not re-throw — SSE generators must close cleanly without an unhandled rejection.
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.logger.log(`🗑️ Deleting session state for ID: ${sessionId}`);
    return this.checkpointer.deleteThread(sessionId);
  }

  async approvePlan(sessionId: string): Promise<AgentRunResult> {
    const config = {
      configurable: { thread_id: sessionId },
      recursionLimit: 200,
    };
    const snapshot = await this.app.getState(config);
    const values = snapshot.values as Partial<AgentState>;

    if (!values.reviewRequest) {
      throw new BadRequestException('No pending plan review for this session.');
    }
    const first = values.plan?.[0];
    if (!first) {
      throw new BadRequestException('Session has an empty plan.');
    }

    const previousMemory = await this._tryLoadSessionMemory(sessionId);
    await this.app.updateState(
      config,
      beginExecutionStep(first, 0, { reviewRequest: undefined }),
    );
    const result: any = await this.app.invoke(null, config);

    await this._persistSessionMemory(
      sessionId,
      values.objective ?? values.input ?? '',
      result,
      previousMemory,
    );

    return { result: result.finalAnswer ?? 'Completed.', sessionId };
  }

  async rejectPlan(sessionId: string): Promise<void> {
    const config = {
      configurable: { thread_id: sessionId },
      recursionLimit: 200,
    };
    const snapshot = await this.app.getState(config);
    const values = snapshot.values as Partial<AgentState>;

    if (!values.reviewRequest) {
      throw new BadRequestException('No pending plan review for this session.');
    }

    await this.app.updateState(
      config,
      failAgentRun('Plan rejected by user.', {
        code: 'unknown',
        message: 'User rejected the plan',
        atPhase: AGENT_PHASES.AWAIT_PLAN_REVIEW,
      }),
    );
  }

  async replanSession(sessionId: string): Promise<AgentRunResult> {
    const config = {
      configurable: { thread_id: sessionId },
      recursionLimit: 200,
    };
    const snapshot = await this.app.getState(config);
    const values = snapshot.values as Partial<AgentState>;

    if (!values.reviewRequest) {
      throw new BadRequestException('No pending plan review for this session.');
    }

    const previousMemory = await this._tryLoadSessionMemory(sessionId);
    await this.app.updateState(
      config,
      transitionToPhase(AGENT_PHASES.RESEARCH, {
        reviewRequest: undefined,
        plan: [],
      }),
    );
    const result: any = await this.app.invoke(null, config);

    await this._persistSessionMemory(
      sessionId,
      values.objective ?? values.input ?? '',
      result,
      previousMemory,
    );

    return { result: result.finalAnswer ?? 'Completed.', sessionId };
  }

  async getReviewPageData(sessionId: string): Promise<ReviewPageData> {
    const config = {
      configurable: { thread_id: sessionId },
      recursionLimit: 200,
    };
    const snapshot = await this.app.getState(config);
    const values = snapshot.values as Partial<AgentState>;

    if (!values.reviewRequest) {
      throw new BadRequestException('No pending plan review for this session.');
    }

    return {
      sessionId,
      objective: values.reviewRequest.objective ?? '(no objective set)',
      plan: values.reviewRequest.plan,
    };
  }

  private _repoFingerprintCache?: string;

  private async _getRepoFingerprint(): Promise<string> {
    if (this._repoFingerprintCache) return this._repoFingerprintCache;
    try {
      const { execSync } = await import('node:child_process');
      this._repoFingerprintCache = execSync('git rev-parse HEAD', {
        encoding: 'utf8',
      })
        .trim()
        .slice(0, 12);
    } catch {
      this._repoFingerprintCache = 'nogit';
    }
    return this._repoFingerprintCache;
  }

  private async _buildCacheKey(
    prompt: string,
    sessionId: string,
    sessionMemory?: string,
  ): Promise<string> {
    const gitHash = await this._getRepoFingerprint();
    const memHash = sessionMemory
      ? crypto.createHash('md5').update(sessionMemory).digest('hex').slice(0, 8)
      : 'nomem';
    const body = `${sessionId}:${gitHash}:${memHash}:${prompt}`;
    const hash = crypto.createHash('sha256').update(body).digest('hex');
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

  private async _autoUpsertVectorMemory(
    prompt: string,
    result: Partial<AgentState>,
    repoFingerprint: string,
  ): Promise<void> {
    const answer = result.finalAnswer;
    if (!answer) return;
    const objective = (result.objective ?? prompt).slice(0, 300);
    const text = `Objective: ${objective}\nSolution: ${answer.slice(0, 600)}`;
    try {
      await upsertVectorMemory({
        text,
        metadata: {
          repoFingerprint,
          timestamp: Date.now(),
          salience: 0.8,
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Auto vector upsert failed: ${message}`);
    }
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
