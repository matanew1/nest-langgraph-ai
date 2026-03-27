import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Delete,
  Post,
  Get,
  UseGuards,
  Param,
  BadRequestException,
  Redirect,
} from '@nestjs/common';
import { Sse, MessageEvent } from '@nestjs/common';
import { Observable, from, map } from 'rxjs';
import {
  AgentsService,
  AgentRunResult,
  ReviewPageData,
  StreamEvent,
} from './agents.service';
import { ListSessionsResponseDto, SessionDetailDto } from './agents.dto';
import { ThrottlerGuard } from '@nestjs/throttler';
import {
  RunAgentDto,
  RunAgentResponseDto,
  StreamAgentDto,
  AddMemoryEntryDto,
  SessionMemoryResponseDto,
  SubmitFeedbackDto,
  FeedbackStatsResponseDto,
} from './agents.dto';
import { ApiBody, ApiOperation, ApiTags, ApiResponse } from '@nestjs/swagger';
import { ApiStandardResponse } from '@common/decorators/api-standard-response.decorator';
import { ApiStandardDeleteResponse } from '@common/decorators/api-standard-delete-response.decorator';
import { ApiSessionIdParam } from '@common/decorators/api-session-id-param.decorator';

@Controller('agents')
@UseGuards(ThrottlerGuard)
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  @Post('run')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Run the AI agent with a natural-language prompt' })
  @ApiBody({ type: RunAgentDto })
  @ApiStandardResponse({
    type: RunAgentResponseDto,
    description: 'Agent answer',
  })
  @ApiTags('Conversations')
  async run(@Body() body: RunAgentDto): Promise<AgentRunResult> {
    return this.agentsService.run(
      body.prompt ?? '',
      body.sessionId,
      body.images,
    );
  }

  @Post('stream')
  @HttpCode(HttpStatus.OK)
  @Sse()
  @ApiOperation({
    summary: 'Stream the AI agent execution in real-time via SSE',
    description:
      'Server-Sent Events endpoint for progressive agent updates (steps, tool calls, chunks). Supports Swagger UI streaming.',
  })
  @ApiBody({ type: StreamAgentDto })
  @ApiResponse({
    status: 200,
    description: 'SSE stream',
    content: {
      'text/event-stream': {
        schema: {
          type: 'object',
          properties: {
            data: { type: 'string' },
            event: {
              type: 'string',
              enum: [
                'status',
                'plan',
                'tool_call_started',
                'tool_call_finished',
                'llm_token',
                'llm_stream_reset',
                'review_required',
                'final',
                'error',
              ],
            },
            id: { type: 'string' },
          },
        },
      },
    },
  })
  @ApiTags('Conversations')
  stream(@Body() body: StreamAgentDto): Observable<MessageEvent> {
    return from(
      this.agentsService.streamRun(
        body.prompt ?? '',
        body.sessionId,
        body.streamPhases as any,
        body.images,
      ),
    ).pipe(
      map((event: StreamEvent) => {
        return {
          data: JSON.stringify(event),
          id: event.sessionId,
          type: event.type,
        } as unknown as MessageEvent;
      }),
    );
  }

  @Get('sessions')
  @HttpCode(HttpStatus.OK)
  @ApiTags('Sessions')
  @ApiOperation({ summary: 'List all active sessions with metadata' })
  @ApiStandardResponse({
    type: ListSessionsResponseDto,
    description: 'All active sessions sorted by most recent activity',
  })
  async listSessions(): Promise<ListSessionsResponseDto> {
    return this.agentsService.listSessions();
  }

  @Get('session/:sessionId/detail')
  @HttpCode(HttpStatus.OK)
  @ApiTags('Sessions')
  @ApiOperation({
    summary: 'Get full detail for a session including conversation history',
  })
  @ApiSessionIdParam()
  @ApiStandardResponse({
    type: SessionDetailDto,
    description: 'Session detail with memory entries and last state',
  })
  async getSessionDetail(
    @Param('sessionId') sessionId: string,
  ): Promise<SessionDetailDto> {
    return this.agentsService.getSessionDetail(sessionId);
  }

  @Delete('session/:sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiTags('Sessions')
  @ApiOperation({ summary: 'Delete an agent session state from Redis' })
  @ApiSessionIdParam()
  @ApiStandardDeleteResponse({
    description: 'Session state deleted successfully',
  })
  async deleteSession(@Param('sessionId') sessionId: string): Promise<void> {
    return this.agentsService.deleteSession(sessionId);
  }

  @Get('review/:sessionId')
  @Redirect()
  @ApiTags('Plan Review')
  @ApiOperation({
    summary: 'Human plan review page for a paused agent session',
    description:
      'Redirects to the static plan review UI with the session context.',
  })
  @ApiSessionIdParam()
  async reviewPlan(@Param('sessionId') sessionId: string) {
    // Validate session has a pending review before redirecting
    await this.agentsService.getReviewPageData(sessionId);
    return {
      url: `/index.html?sessionId=${sessionId}`,
      statusCode: 302,
    };
  }

  @Get('session/:sessionId/review-data')
  @HttpCode(HttpStatus.OK)
  @ApiTags('Plan Review')
  @ApiOperation({ summary: 'Get pending plan review data as JSON' })
  @ApiSessionIdParam()
  async getReviewData(
    @Param('sessionId') sessionId: string,
  ): Promise<ReviewPageData | null> {
    try {
      return await this.agentsService.getReviewPageData(sessionId);
    } catch (error) {
      // Return null instead of 400 if no review is pending (avoids log noise on page load)
      if (error instanceof BadRequestException) {
        return null;
      }
      throw error;
    }
  }

  @Post('session/:sessionId/approve')
  @HttpCode(HttpStatus.OK)
  @ApiTags('Plan Review')
  @ApiOperation({
    summary: 'Approve a pending plan and resume agent execution',
  })
  @ApiSessionIdParam()
  async approvePlan(
    @Param('sessionId') sessionId: string,
  ): Promise<AgentRunResult> {
    return this.agentsService.approvePlan(sessionId);
  }

  @Post('session/:sessionId/reject')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiTags('Plan Review')
  @ApiOperation({ summary: 'Reject a pending plan and stop the agent run' })
  @ApiSessionIdParam()
  async rejectPlan(@Param('sessionId') sessionId: string): Promise<void> {
    return this.agentsService.rejectPlan(sessionId);
  }

  @Post('session/:sessionId/replan')
  @HttpCode(HttpStatus.OK)
  @ApiTags('Plan Review')
  @ApiOperation({ summary: 'Reject the plan and trigger a full re-plan' })
  @ApiSessionIdParam()
  async replanSession(
    @Param('sessionId') sessionId: string,
  ): Promise<AgentRunResult> {
    return this.agentsService.replanSession(sessionId);
  }

  @Get('session/:sessionId/memory')
  @HttpCode(HttpStatus.OK)
  @ApiTags('Memory')
  @ApiOperation({ summary: 'Get the session memory entries' })
  @ApiSessionIdParam()
  async getSessionMemory(
    @Param('sessionId') sessionId: string,
  ): Promise<SessionMemoryResponseDto> {
    return this.agentsService.getSessionMemory(sessionId);
  }

  @Post('session/:sessionId/memory')
  @HttpCode(HttpStatus.CREATED)
  @ApiTags('Memory')
  @ApiOperation({ summary: 'Add an entry to the session memory' })
  @ApiSessionIdParam()
  @ApiBody({ type: AddMemoryEntryDto })
  async addSessionMemoryEntry(
    @Param('sessionId') sessionId: string,
    @Body() body: AddMemoryEntryDto,
  ): Promise<SessionMemoryResponseDto> {
    return this.agentsService.addSessionMemoryEntry(sessionId, body.entry);
  }

  @Delete('session/:sessionId/memory')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiTags('Memory')
  @ApiOperation({ summary: 'Clear the session memory' })
  @ApiSessionIdParam()
  async clearSessionMemory(
    @Param('sessionId') sessionId: string,
  ): Promise<void> {
    return this.agentsService.clearSessionMemory(sessionId);
  }

  @Post('session/:sessionId/feedback')
  @HttpCode(HttpStatus.OK)
  @ApiTags('Feedback')
  @ApiOperation({ summary: 'Submit feedback to update vector memory salience' })
  @ApiSessionIdParam()
  @ApiBody({ type: SubmitFeedbackDto })
  async submitFeedback(
    @Param('sessionId') sessionId: string,
    @Body() body: SubmitFeedbackDto,
  ): Promise<FeedbackStatsResponseDto> {
    return this.agentsService.submitFeedback(sessionId, body);
  }

  @Get('session/:sessionId/feedback')
  @HttpCode(HttpStatus.OK)
  @ApiTags('Feedback')
  @ApiOperation({ summary: 'Get feedback submission stats for a session' })
  @ApiSessionIdParam()
  async getFeedbackStats(
    @Param('sessionId') sessionId: string,
  ): Promise<FeedbackStatsResponseDto> {
    return this.agentsService.getFeedbackStats(sessionId);
  }
}
