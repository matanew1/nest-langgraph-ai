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

export interface AgentRunResult {
  result: string;
  sessionId: string;
}

const SEPARATOR = '━'.repeat(60);

@Injectable()
export class AgentsService {
  private readonly logger = new Logger(AgentsService.name);
  private checkpointer: RedisSaver;
  
  private app: ReturnType<typeof agentWorkflow.compile>;

  constructor(@Inject(REDIS_CLIENT) private readonly redisClient: Redis) {
    // Note: Ensure your RedisSaver matches the v1.0.0 async SerializerProtocol we updated earlier
    this.checkpointer = new RedisSaver(this.redisClient);
    this.app = agentWorkflow.compile({ checkpointer: this.checkpointer as any });
  }

  async run(prompt: string, sessionId?: string): Promise<AgentRunResult> {
    const elapsed = startTimer();
    const threadId = sessionId || uuidv4();

    this.logger.log(`${SEPARATOR}`);
    this.logger.log(
      `🚀 AGENT RUN START | Session: ${threadId} | Prompt: "${preview(prompt, 100)}"`,
    );
    this.logger.log(SEPARATOR);

    const config = {
      configurable: {
        thread_id: threadId,
      },
      recursionLimit: 100, // Increased to 100 to avoid the "limit of 25" error for multi-step tasks
    };

    try {
      const graphTimeoutMs = env.groqTimeoutMs * env.agentMaxIterations * 4;

      /**
       * FIX: Resetting State for New Prompt
       * Because LangGraph restores the previous state from Redis, we must 
       * explicitly nullify the 'finalAnswer' and 'done' status. 
       * Otherwise, the service returns the old result before the graph even runs.
       */
      const initialState: Partial<AgentState> = { 
        input: prompt, 
        iteration: 0,
        status: 'plan_required',
        currentStep: 0,
        plan: [],
        finalAnswer: null as any, // Explicitly clear old answer
        toolResult: null as any,   // Explicitly clear old tool output
        done: false,
      };

      let timeoutHandle: NodeJS.Timeout;
      const result: any = await Promise.race([
        this.app
          .invoke(initialState, config)
          .finally(() => clearTimeout(timeoutHandle)),
        new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(
            () => reject(new Error(`Agent timed out after ${graphTimeoutMs}ms`)),
            graphTimeoutMs,
          );
        }),
      ]);

      const totalTime = elapsed();

      // Prioritize the finalAnswer generated in this specific run
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
        `🏁 AGENT RUN ${status} | ${steps} steps | ${totalTime}ms | answer=${preview(answer, 120)}`,
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
}