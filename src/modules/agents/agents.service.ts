import {
  Injectable,
  InternalServerErrorException,
  ConflictException,
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
import type { PlanStep, ImageAttachment } from './state/agent.state';
import { AGENT_PHASES, type AgentPhase } from './state/agent-phase';
import { createInitialAgentRunState } from './state/agent-run-state.util';
import {
  upsertVectorMemory,
} from '../vector-db/vector-memory.util';
import { RedisSaver } from './utils/redis-saver';
import type { StreamEventDto } from './agents.dto';
import type {
  SessionMemoryResponseDto,
  SubmitFeedbackDto,
  FeedbackStatsResponseDto,
  ListSessionsResponseDto,
  SessionDetailDto,
} from './agents.dto';
import * as crypto from 'crypto';
import { invokeLlm } from '@llm/llm.provider';
import { selectModelForPhase } from '@llm/model-router';
import { SessionMemoryService } from './services/session-memory.service';
import { PlanReviewService } from './services/plan-review.service';
import { SessionService } from './services/session.service';
import { FeedbackService } from './services/feedback.service';

export interface AgentRunResult {
  result: string;
  sessionId: string;
  reviewRequest?: { objective: string; plan: PlanStep[] };
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
  private readonly checkpointer: RedisSaver;

  private app: ReturnType<typeof agentWorkflow.compile>;

  /** Session lock TTL in seconds — prevents concurrent mutations on same session. */
  private static readonly SESSION_LOCK_TTL = 120;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redisClient: Redis,
    private readonly sessionMemoryService: SessionMemoryService,
    private readonly planReviewService: PlanReviewService,
    private readonly sessionService: SessionService,
    private readonly feedbackService: FeedbackService,
    checkpointer: RedisSaver,
  ) {
    this.checkpointer = checkpointer;
    this.app = agentWorkflow.compile({
      checkpointer: this.checkpointer as any,
    });
    // Share compiled app with sub-services that need graph access
    this.planReviewService.setApp(this.app);
    this.sessionService.setApp(this.app);
  }

  /**
   * Acquire a Redis-backed session lock. Returns a release function.
   * Throws ConflictException if the session is already locked.
   */
  private async acquireSessionLock(
    sessionId: string,
  ): Promise<() => Promise<void>> {
    const lockKey = `session:${sessionId}:lock`;
    const lockValue = uuidv4();
    const acquired = await this.redisClient.set(
      lockKey,
      lockValue,
      'EX',
      AgentsService.SESSION_LOCK_TTL,
      'NX',
    );
    if (!acquired) {
      throw new ConflictException(
        `Session ${sessionId} is already being processed. Please wait for the current request to complete.`,
      );
    }
    return async () => {
      // Atomic compare-and-delete via Lua to avoid TOCTOU:
      // GET + DEL as two separate calls could delete a lock that another request
      // just acquired between the two operations.
      const luaScript = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;
      await this.redisClient.eval(luaScript, 1, lockKey, lockValue);
    };
  }

  async run(
    prompt: string,
    sessionId?: string,
    images?: ImageAttachment[],
  ): Promise<AgentRunResult> {
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

    const releaseLock = await this.acquireSessionLock(threadId);
    try {
      const sessionMemory = await this.sessionMemoryService.tryLoad(threadId);
      const cacheKey = await this._buildCacheKey(
        prompt,
        threadId,
        sessionMemory,
        images,
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

      const graphTimeoutMs = Math.min(
        env.mistralTimeoutMs * env.agentMaxIterations * 4,
        300_000, // hard cap at 5 minutes
      );
      const initialState = createInitialAgentRunState(prompt, {
        sessionMemory,
        sessionId: threadId,
        images,
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

      await this.sessionMemoryService.persist(threadId, prompt, result, sessionMemory);

      if (result.vectorMemoryIds?.length) {
        await this.checkpointer.setVectorMemoryIds(
          threadId,
          result.vectorMemoryIds,
        );
      }

      if (result.phase === AGENT_PHASES.COMPLETE) {
        this._autoUpsertVectorMemory(
          prompt,
          result,
          await this._getRepoFingerprint(),
        ).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.warn(`Vector memory upsert failed (non-fatal): ${msg}`);
        });
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
    } finally {
      await releaseLock().catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Failed to release session lock: ${msg}`);
      });
    }
  }

  async *streamRun(
    prompt: string,
    sessionId?: string,
    streamPhases?: AgentPhase[],
    images?: ImageAttachment[],
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

    const releaseLock = await this.acquireSessionLock(threadId);
    try {
      const sessionMemory = await this.sessionMemoryService.tryLoad(threadId);
      const tokenQueue: string[] = [];
      const onToken = (token: string): void => {
        tokenQueue.push(token);
      };
      const initialState = createInitialAgentRunState(prompt, {
        sessionMemory,
        sessionId: threadId,
        onToken,
        streamPhases,
        images,
      });

      yield {
        type: 'status',
        data: `Starting agent execution...`,
        sessionId: threadId,
        done: false,
      };

      const stream = await this.app.stream(initialState as any, config);
      let lastEmittedModel: string | undefined;

      for await (const event of stream) {
        const node = Object.keys(event)[0];
        const snap = event[node] as Partial<AgentState>;

        // Emit model_switch whenever the active model changes with the phase
        if (snap.phase) {
          const currentModel = selectModelForPhase(snap.phase);
          if (currentModel !== lastEmittedModel) {
            lastEmittedModel = currentModel;
            yield {
              type: 'model_switch',
              data: JSON.stringify({ model: currentModel, phase: snap.phase }),
              sessionId: threadId,
              model: currentModel,
              done: false,
            };
          }
        }

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

      await this.sessionMemoryService.persist(
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
    } finally {
      await releaseLock();
    }
  }

  async enhancePrompt(prompt: string): Promise<string> {
    const systemPrompt = `You are an expert prompt engineer for an AI coding and research assistant.
The assistant uses a LangGraph architecture with tools for:
- File system access (reading/writing files, creating directories)
- Terminal execution (running bash commands, e.g. npm builds, tests)
- Web search (Tavily API)
- Mermaid diagram generation

Your task is to take the user's raw prompt and enhance it to get the best possible results from the agent.
Make the enhanced prompt:
1. Clear, specific, and highly actionable.
2. Written as plain prose — one or two sentences max. NO markdown, NO bullet points, NO headers, NO code fences.
3. Explicit about edge cases, constraints, and the expected final output format.
4. If the user's prompt is already good, simply clean it up and return it.
5. DO NOT answer their question or perform their request. ONLY rewrite their prompt.
6. Return ONLY the final enhanced prompt text as a plain sentence — no intro, no outro, no formatting whatsoever.

Original user prompt:
"${prompt}"

Enhanced prompt:`;

    try {
      const result = await invokeLlm(systemPrompt);
      // Remove any surrounding quotes the LLM might have incorrectly added
      return result
        .trim()
        .replace(/^["']|["']$/g, '')
        .trim();
    } catch (err) {
      this.logger.error(`Failed to enhance prompt: ${err}`);
      return prompt; // fallback to original prompt on failure
    }
  }

  // ── Delegated: Session management ──────────────────────────────

  async listSessions(): Promise<ListSessionsResponseDto> {
    return this.sessionService.listSessions();
  }

  async getSessionDetail(sessionId: string): Promise<SessionDetailDto> {
    return this.sessionService.getSessionDetail(sessionId);
  }

  async listCheckpoints(sessionId: string) {
    return this.sessionService.listCheckpoints(sessionId);
  }

  async deleteSession(sessionId: string): Promise<void> {
    return this.sessionService.deleteSession(sessionId);
  }

  // ── Delegated: Plan review ───────────────────────────────────

  async getReviewPageData(sessionId: string): Promise<ReviewPageData> {
    return this.planReviewService.getReviewPageData(sessionId);
  }

  async approvePlan(sessionId: string): Promise<AgentRunResult> {
    return this.planReviewService.approve(
      sessionId,
      this.acquireSessionLock.bind(this),
    );
  }

  async rejectPlan(sessionId: string): Promise<void> {
    return this.planReviewService.reject(sessionId);
  }

  async replanSession(sessionId: string): Promise<AgentRunResult> {
    return this.planReviewService.replan(
      sessionId,
      this.acquireSessionLock.bind(this),
    );
  }

  // ── Delegated: Session memory ────────────────────────────────

  async getSessionMemory(sessionId: string): Promise<SessionMemoryResponseDto> {
    return this.sessionMemoryService.getSessionMemory(sessionId);
  }

  async addSessionMemoryEntry(
    sessionId: string,
    entry: string,
  ): Promise<SessionMemoryResponseDto> {
    return this.sessionMemoryService.addEntry(sessionId, entry);
  }

  async clearSessionMemory(sessionId: string): Promise<void> {
    return this.sessionMemoryService.clear(sessionId);
  }

  // ── Delegated: Feedback ──────────────────────────────────────

  async submitFeedback(
    sessionId: string,
    dto: SubmitFeedbackDto,
  ): Promise<FeedbackStatsResponseDto> {
    return this.feedbackService.submitFeedback(sessionId, dto);
  }

  async getFeedbackStats(sessionId: string): Promise<FeedbackStatsResponseDto> {
    return this.feedbackService.getFeedbackStats(sessionId);
  }

  // ── Private helpers (kept in orchestrator) ───────────────────

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
    _sessionId: string,
    sessionMemory?: string,
    images?: ImageAttachment[],
  ): Promise<string> {
    const gitHash = await this._getRepoFingerprint();
    const memHash = sessionMemory
      ? crypto.createHash('md5').update(sessionMemory).digest('hex').slice(0, 8)
      : 'nomem';
    const imagesHash =
      images && images.length > 0
        ? crypto
            .createHash('sha256')
            .update(JSON.stringify(images.map((image) => image.url)))
            .digest('hex')
            .slice(0, 12)
        : 'noimg';
    const body = `${gitHash}:${memHash}:${imagesHash}:${prompt}`;
    const hash = crypto.createHash('sha256').update(body).digest('hex');
    return `agent:cache:${hash}`;
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
}
