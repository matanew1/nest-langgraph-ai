import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Delete,
  Post,
  Get,
  Query,
  UseGuards,
  Param,
} from '@nestjs/common';
import { Sse, MessageEvent } from '@nestjs/common';
import { Observable, from, map } from 'rxjs';
import { AgentsService, AgentRunResult, StreamEvent } from './agents.service';
import { ThrottlerGuard } from '@nestjs/throttler';
import { RunAgentDto, RunAgentResponseDto, StreamAgentDto } from './agents.dto';
import {
  ApiBody,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiResponse,
} from '@nestjs/swagger';
import { ApiStandardResponse } from '@common/decorators/api-standard-response.decorator';
import { ApiStandardDeleteResponse } from '@common/decorators/api-standard-delete-response.decorator';
import { ApiSessionIdParam } from '@common/decorators/api-session-id-param.decorator';

@ApiTags('Agents')
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
  async run(@Body() body: RunAgentDto): Promise<AgentRunResult> {
    return this.agentsService.run(body.prompt, body.sessionId);
  }

  @Get('stream')
  @Sse()
  @ApiOperation({
    summary: 'Stream the AI agent execution in real-time via SSE',
    description:
      'Server-Sent Events endpoint for progressive agent updates (steps, tool calls, chunks). Supports Swagger UI streaming.',
  })
  @ApiQuery({ name: 'prompt', type: 'string', required: true })
  @ApiQuery({ name: 'sessionId', type: 'string', required: false })
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
  stream(@Query() query: StreamAgentDto): Observable<MessageEvent> {
    return from(
      this.agentsService.streamRun(query.prompt, query.sessionId),
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

  @Delete('session/:sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an agent session state from Redis' })
  @ApiSessionIdParam()
  @ApiStandardDeleteResponse({
    description: 'Session state deleted successfully',
  })
  async deleteSession(@Param('sessionId') sessionId: string): Promise<void> {
    return this.agentsService.deleteSession(sessionId);
  }

  @Post('session/:sessionId/approve')
  @HttpCode(HttpStatus.OK)
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
  @ApiOperation({ summary: 'Reject a pending plan and stop the agent run' })
  @ApiSessionIdParam()
  async rejectPlan(@Param('sessionId') sessionId: string): Promise<void> {
    return this.agentsService.rejectPlan(sessionId);
  }

  @Post('session/:sessionId/replan')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject the plan and trigger a full re-plan' })
  @ApiSessionIdParam()
  async replanSession(
    @Param('sessionId') sessionId: string,
  ): Promise<AgentRunResult> {
    return this.agentsService.replanSession(sessionId);
  }
}
