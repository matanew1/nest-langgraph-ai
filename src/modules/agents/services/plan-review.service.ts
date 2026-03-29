import {
  Injectable,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { AGENT_PHASES } from '../state/agent-phase';
import {
  beginExecutionStep,
  failAgentRun,
  transitionToPhase,
} from '../state/agent-transition.util';
import type { AgentState } from '../state/agent.state';
import type { AgentRunResult, ReviewPageData } from '../agents.service';
import { SessionMemoryService } from './session-memory.service';
import { RedisSaver } from '../utils/redis-saver';

/** Safe session ID pattern. */
const SESSION_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function assertValidSessionId(sessionId: string): void {
  if (!SESSION_ID_RE.test(sessionId)) {
    throw new BadRequestException(
      `Invalid sessionId "${sessionId}". Must be 1–64 alphanumeric/hyphen/underscore characters.`,
    );
  }
}

@Injectable()
export class PlanReviewService {
  private readonly logger = new Logger(PlanReviewService.name);

  constructor(
    private readonly sessionMemory: SessionMemoryService,
    private readonly checkpointer: RedisSaver,
  ) {}

  /**
   * The compiled LangGraph app is injected after construction by AgentsService,
   * since the graph is compiled in AgentsService's constructor.
   */
  private app!: any;

  /** Called by AgentsService to share the compiled graph app. */
  setApp(app: any): void {
    this.app = app;
  }

  async getReviewPageData(sessionId: string): Promise<ReviewPageData> {
    assertValidSessionId(sessionId);
    const config = { configurable: { thread_id: sessionId }, recursionLimit: 200 };
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

  async approve(
    sessionId: string,
    acquireLock: (sid: string) => Promise<() => Promise<void>>,
  ): Promise<AgentRunResult> {
    assertValidSessionId(sessionId);
    const config = { configurable: { thread_id: sessionId }, recursionLimit: 200 };
    const snapshot = await this.app.getState(config);
    const values = snapshot.values as Partial<AgentState>;

    if (!values.reviewRequest) {
      throw new BadRequestException('No pending plan review for this session.');
    }
    const first = values.plan?.[0];
    if (!first) {
      throw new BadRequestException('Session has an empty plan.');
    }

    const releaseLock = await acquireLock(sessionId);
    try {
      const previousMemory = await this.sessionMemory.tryLoad(sessionId);
      const firstStepUpdate =
        first.parallel_group !== undefined
          ? transitionToPhase(AGENT_PHASES.EXECUTE_PARALLEL, {
              currentStep: 0,
              reviewRequest: undefined,
            })
          : beginExecutionStep(first, 0, { reviewRequest: undefined });
      await this.app.updateState(config, firstStepUpdate);
      const result: any = await this.app.invoke(null, config);

      await this.sessionMemory.persist(
        sessionId,
        values.objective ?? values.input ?? '',
        result,
        previousMemory,
      );

      if (result.vectorMemoryIds?.length) {
        await this.checkpointer.setVectorMemoryIds(
          sessionId,
          result.vectorMemoryIds as string[],
        );
      }

      return { result: result.finalAnswer ?? 'Completed.', sessionId };
    } finally {
      await releaseLock();
    }
  }

  async reject(sessionId: string): Promise<void> {
    assertValidSessionId(sessionId);
    const config = { configurable: { thread_id: sessionId }, recursionLimit: 200 };
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

  async replan(
    sessionId: string,
    acquireLock: (sid: string) => Promise<() => Promise<void>>,
  ): Promise<AgentRunResult> {
    assertValidSessionId(sessionId);
    const config = { configurable: { thread_id: sessionId }, recursionLimit: 200 };
    const snapshot = await this.app.getState(config);
    const values = snapshot.values as Partial<AgentState>;

    if (!values.reviewRequest) {
      throw new BadRequestException('No pending plan review for this session.');
    }

    const releaseLock = await acquireLock(sessionId);
    try {
      const previousMemory = await this.sessionMemory.tryLoad(sessionId);
      await this.app.updateState(
        config,
        transitionToPhase(AGENT_PHASES.RESEARCH, {
          reviewRequest: undefined,
          plan: [],
        }),
      );
      const result: any = await this.app.invoke(null, config);

      await this.sessionMemory.persist(
        sessionId,
        values.objective ?? values.input ?? '',
        result,
        previousMemory,
      );

      if (result.vectorMemoryIds?.length) {
        await this.checkpointer.setVectorMemoryIds(
          sessionId,
          result.vectorMemoryIds as string[],
        );
      }

      if (result.reviewRequest) {
        return { result: 'New plan ready for review.', sessionId, reviewRequest: result.reviewRequest };
      }
      return { result: result.finalAnswer ?? 'Completed.', sessionId };
    } finally {
      await releaseLock();
    }
  }
}
