import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Delete,
  Post,
  UseGuards,
  Param,
} from '@nestjs/common';
import { AgentsService, AgentRunResult } from './agents.service';
import { ThrottlerGuard } from '@nestjs/throttler';
import { RunAgentDto, RunAgentResponseDto } from './agents.dto';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ErrorResponseDto } from '@common/dto/error-response.dto';

@ApiTags('Agents')
@Controller('agents')
@UseGuards(ThrottlerGuard)
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  @Post('run')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Run the AI agent with a natural-language prompt' })
  @ApiBody({ type: RunAgentDto })
  @ApiResponse({
    status: HttpStatus.OK,
    type: RunAgentResponseDto,
    description: 'Agent answer',
  })
  @ApiResponse({
    status: 400,
    type: ErrorResponseDto,
    description: 'Invalid request body',
  })
  @ApiResponse({
    status: 429,
    type: ErrorResponseDto,
    description: 'Too many requests',
  })
  @ApiResponse({
    status: 500,
    type: ErrorResponseDto,
    description: 'Agent failed to produce an answer',
  })
  async run(@Body() body: RunAgentDto): Promise<AgentRunResult> {
    return this.agentsService.run(body.prompt, body.sessionId);
  }

  @Delete('session/:sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an agent session state from Redis' })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: 'Session state deleted successfully.',
  })
  @ApiResponse({
    status: 500,
    description: 'Failed to delete session state.',
    type: ErrorResponseDto,
  })
  async deleteSession(@Param('sessionId') sessionId: string): Promise<void> {
    return this.agentsService.deleteSession(sessionId);
  }
}
