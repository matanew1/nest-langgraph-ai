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
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
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

  @Delete('session/:sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an agent session state from Redis' })
  @ApiSessionIdParam()
  @ApiStandardDeleteResponse({ description: 'Session state deleted successfully' })
  async deleteSession(@Param('sessionId') sessionId: string): Promise<void> {
    return this.agentsService.deleteSession(sessionId);
  }
}
