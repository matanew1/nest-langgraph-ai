import { Injectable, Logger, Inject } from '@nestjs/common';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '@redis/redis.constants';
import { env } from '@config/env';
import { preview } from '@utils/pretty-log.util';
import { invokeLlm } from '@llm/llm.provider';
import { selectModelForTier } from '@llm/model-router';
import { RedisSaver } from '../utils/redis-saver';
import type { AgentState } from '../state/agent.state';
import type { SessionMemoryResponseDto } from '../agents.dto';

/** Safe session ID pattern. */
const SESSION_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

@Injectable()
export class SessionMemoryService {
  private readonly logger = new Logger(SessionMemoryService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redisClient: Redis,
    private readonly checkpointer: RedisSaver,
  ) {}

  async tryLoad(threadId: string): Promise<string | undefined> {
    try {
      return await this.checkpointer.getThreadMemory(threadId);
    } catch {
      return undefined;
    }
  }

  async getSessionMemory(sessionId: string): Promise<SessionMemoryResponseDto> {
    this.assertValid(sessionId);
    const raw = await this.tryLoad(sessionId);
    const entries = this.parseEntries(raw);
    return { sessionId, entries, raw: raw ?? '' };
  }

  async addEntry(
    sessionId: string,
    entry: string,
  ): Promise<SessionMemoryResponseDto> {
    this.assertValid(sessionId);
    const existing = await this.tryLoad(sessionId);
    const merged = this.merge(existing, entry.trim());
    await this.checkpointer.setThreadMemory(sessionId, merged);
    const entries = this.parseEntries(merged);
    return { sessionId, entries, raw: merged };
  }

  async clear(sessionId: string): Promise<void> {
    this.assertValid(sessionId);
    await this.checkpointer.setThreadMemory(sessionId, '');
  }

  async persist(
    threadId: string,
    prompt: string,
    result: Partial<AgentState>,
    previousMemory?: string,
  ): Promise<void> {
    const entry = await this.buildEntry(prompt, result);
    if (!entry) return;

    const merged = this.merge(previousMemory, entry);

    try {
      await this.checkpointer.setThreadMemory(threadId, merged);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to persist session memory: ${message}`);
    }
  }

  merge(previousMemory: string | undefined, entry: string): string {
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
    return merged.length > maxChars
      ? merged.slice(0, maxChars) + '\n...[truncated]'
      : merged;
  }

  parseEntries(raw: string | undefined): string[] {
    return raw
      ? raw
          .split('\n---\n')
          .map((e) => e.trim())
          .filter(Boolean)
      : [];
  }

  private async buildEntry(
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
    const SHORT_ANSWER_THRESHOLD = 300;

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

        const facts = await invokeLlm(
          extractionPrompt,
          undefined,
          undefined,
          undefined,
          selectModelForTier('fast'),
        );
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

    return [
      `[${timestamp}]`,
      `Objective: ${preview(objective, 160)}`,
      `Outcome: ${preview(answer, 280)}`,
    ].join('\n');
  }

  private assertValid(sessionId: string): void {
    if (!SESSION_ID_RE.test(sessionId)) {
      throw new Error(
        `Invalid sessionId "${sessionId}". Must be 1–64 alphanumeric/hyphen/underscore characters.`,
      );
    }
  }
}
