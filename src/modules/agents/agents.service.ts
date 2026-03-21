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
import { SessionMemoryResponseDto } from './agents.dto';
import * as crypto from 'crypto';
import { invokeLlm } from '@llm/llm.provider';

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

      if (result.vectorMemoryIds?.length) {
        await this.checkpointer.setVectorMemoryIds(
          threadId,
          result.vectorMemoryIds,
        );
      }

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
    streamPhases?: string[],
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
      const tokenQueue: string[] = [];
      const onToken = (token: string): void => {
        tokenQueue.push(token);
      };
      const initialState = createInitialAgentRunState(prompt, {
        sessionMemory,
        sessionId: threadId,
        onToken,
        streamPhases,
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

        // Drain any tokens collected during this node's LLM call.
        if (tokenQueue.length > 0) {
          yield {
            type: 'llm_stream_reset',
            data: '',
            sessionId: threadId,
            done: false,
          };
          for (const token of tokenQueue.splice(0)) {
            yield {
              type: 'llm_token',
              data: token,
              sessionId: threadId,
              done: false,
            };
          }
        }
      }

      // Drain any tokens produced by the final node — the for-await loop has already exited by now.
      if (tokenQueue.length > 0) {
        yield {
          type: 'llm_stream_reset',
          data: '',
          sessionId: threadId,
          done: false,
        };
        // splice(0) atomically removes and returns all elements — correct since JS is single-threaded
        // and no tokens can be pushed during a yield suspension.
        for (const token of tokenQueue.splice(0)) {
          yield {
            type: 'llm_token',
            data: token,
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
      } else if (
        finalValues.phase === AGENT_PHASES.AWAIT_PLAN_REVIEW &&
        finalValues.reviewRequest
      ) {
        // LangGraph interrupt() throws before emitting the node's stream event,
        // so the review_required event must be emitted here from the final state.
        yield {
          type: 'review_required',
          data: JSON.stringify(finalValues.reviewRequest),
          sessionId: threadId,
          done: false,
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

      if (finalValues.vectorMemoryIds?.length) {
        await this.checkpointer.setVectorMemoryIds(
          threadId,
          finalValues.vectorMemoryIds,
        );
      }

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
      const message = err?.message || String(err);
      let errorDetail: string;

      if (err instanceof HttpException) {
        errorDetail = `Stream failed (HTTP ${err.getStatus()}): ${message}`;
      } else if (
        message.includes('timed out') ||
        message.includes('timeout') ||
        err?.name === 'AbortError'
      ) {
        errorDetail = `Stream failed (timeout): ${message}`;
      } else if (
        message.includes('ECONNREFUSED') ||
        message.includes('ECONNRESET') ||
        message.includes('Redis')
      ) {
        errorDetail = `Stream failed (infrastructure): ${message}`;
      } else {
        errorDetail = `Stream failed: ${message}`;
      }

      this.logger.error(errorDetail);
      yield {
        type: 'error',
        data: errorDetail,
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
    // If the first step belongs to a parallel group, resume to EXECUTE_PARALLEL
    // rather than serial EXECUTE to avoid incorrect routing.
    const firstStepUpdate =
      first.parallel_group !== undefined
        ? transitionToPhase(AGENT_PHASES.EXECUTE_PARALLEL, {
            currentStep: 0,
            reviewRequest: undefined,
          })
        : beginExecutionStep(first, 0, { reviewRequest: undefined });
    await this.app.updateState(config, firstStepUpdate);
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

  async getSessionMemory(sessionId: string): Promise<SessionMemoryResponseDto> {
    const raw = await this._tryLoadSessionMemory(sessionId);
    const entries = raw
      ? raw
          .split('\n---\n')
          .map((e) => e.trim())
          .filter(Boolean)
      : [];
    return { sessionId, entries, raw: raw ?? '' };
  }

  async addSessionMemoryEntry(
    sessionId: string,
    entry: string,
  ): Promise<SessionMemoryResponseDto> {
    const existing = await this._tryLoadSessionMemory(sessionId);
    const merged = this._mergeSessionMemory(existing, entry.trim());
    await this.checkpointer.setThreadMemory(sessionId, merged);
    const entries = merged
      .split('\n---\n')
      .map((e) => e.trim())
      .filter(Boolean);
    return { sessionId, entries, raw: merged };
  }

  async clearSessionMemory(sessionId: string): Promise<void> {
    await this.checkpointer.setThreadMemory(sessionId, '');
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
    const entry = await this._buildSessionMemoryEntry(prompt, result);
    if (!entry) return;

    const merged = this._mergeSessionMemory(previousMemory, entry);

    try {
      await this.checkpointer.setThreadMemory(threadId, merged);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to persist session memory: ${message}`);
    }
  }

  /**
   * Build a session memory entry for the completed run.
   *
   * When the run produced a final answer, we ask the LLM to extract a compact
   * set of key facts so future turns receive structured, signal-dense context
   * rather than a raw answer dump. Falls back to the plain objective+outcome
   * format if the LLM call fails or there is no final answer.
   */
  private async _buildSessionMemoryEntry(
    prompt: string,
    result: Partial<AgentState>,
  ): Promise<string | undefined> {
    const objective = (result.objective ?? prompt).trim();
    const answer =
      result.finalAnswer ??
      result.toolResult?.preview ??
      result.toolResultRaw ??
      undefined;

    if (!objective || !answer) return undefined;

    const timestamp = new Date().toISOString();

    // Skip LLM fact extraction for short answers — plain format is sufficient.
    const SHORT_ANSWER_THRESHOLD = 300;

    // Attempt LLM-based fact extraction for richer cross-turn context.
    if (result.finalAnswer && answer.length >= SHORT_ANSWER_THRESHOLD) {
      try {
        const extractionPrompt = [
          `Extract 2-4 key facts or learnings from this completed AI agent run.`,
          `Each fact must be a single sentence that would help a future AI agent answer`,
          `follow-up questions or avoid repeating the same work.`,
          ``,
          `Objective: ${preview(objective, 200)}`,
          `Outcome: ${preview(answer, 400)}`,
          ``,
          `Rules:`,
          `- Include concrete values: file paths, function names, command results, decisions made.`,
          `- Do NOT include vague summaries like "the task was completed successfully".`,
          `- Output as plain numbered list (1. ... 2. ... etc.), no JSON, no markdown headers.`,
          `- Maximum 4 facts, each under 120 characters.`,
          ``,
          `Facts:`,
        ].join('\n');

        const facts = await invokeLlm(extractionPrompt);
        const trimmedFacts = facts.trim();

        if (trimmedFacts) {
          return [
            `[${timestamp}]`,
            `Objective: ${preview(objective, 160)}`,
            `Key facts:\n${trimmedFacts}`,
          ].join('\n');
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Session memory fact extraction failed: ${message} — using plain format`,
        );
      }
    }

    // Fallback: plain objective + outcome format
    return [
      `[${timestamp}]`,
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
