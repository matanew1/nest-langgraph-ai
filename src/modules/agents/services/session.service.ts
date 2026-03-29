import {
  Injectable,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import type { AgentState } from '../state/agent.state';
import { SessionMemoryService } from './session-memory.service';
import { RedisSaver } from '../utils/redis-saver';
import type {
  ListSessionsResponseDto,
  SessionSummaryDto,
  SessionDetailDto,
} from '../agents.dto';

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
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private readonly sessionMemory: SessionMemoryService,
    private readonly checkpointer: RedisSaver,
  ) {}

  private app!: any;

  /** Called by AgentsService to share the compiled graph app. */
  setApp(app: any): void {
    this.app = app;
  }

  async listSessions(): Promise<ListSessionsResponseDto> {
    const sessionIds = await this.checkpointer.listSessionIds();
    const summaries: SessionSummaryDto[] = [];

    for (const sessionId of sessionIds) {
      const memory = await this.sessionMemory.tryLoad(sessionId);
      const entries = this.sessionMemory.parseEntries(memory);
      const latest = entries[0] ?? '';
      const tsMatch = latest.match(/^\[(.+?)\]/);
      const objMatch = latest.match(/^Objective:\s*(.+)$/m);
      summaries.push({
        sessionId,
        lastActivity: tsMatch ? tsMatch[1] : null,
        lastObjective: objMatch ? objMatch[1].trim().slice(0, 120) : null,
        messageCount: entries.length,
      });
    }

    summaries.sort((a, b) => {
      if (!a.lastActivity && !b.lastActivity) return 0;
      if (!a.lastActivity) return 1;
      if (!b.lastActivity) return -1;
      return (
        new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
      );
    });

    return { sessions: summaries, total: summaries.length };
  }

  async getSessionDetail(sessionId: string): Promise<SessionDetailDto> {
    assertValidSessionId(sessionId);
    const memory = await this.sessionMemory.tryLoad(sessionId);
    const entries = this.sessionMemory.parseEntries(memory);

    let lastInput: string | null = null;
    let lastObjective: string | null = null;
    let phase: string | null = null;

    try {
      const config = {
        configurable: { thread_id: sessionId },
        recursionLimit: 200,
      };
      const snapshot = await this.app.getState(config);
      const values = snapshot.values as Partial<AgentState>;
      lastInput = values.input ?? null;
      lastObjective = values.objective ?? null;
      phase = values.phase ?? null;
    } catch {
      // Session may not have a checkpoint yet
    }

    return {
      sessionId,
      entries,
      raw: memory ?? '',
      lastInput,
      lastObjective,
      phase,
    };
  }

  async deleteSession(sessionId: string): Promise<void> {
    assertValidSessionId(sessionId);
    this.logger.log(`Deleting session state for ID: ${sessionId}`);
    return this.checkpointer.deleteThread(sessionId);
  }
}
