import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AgentsService } from './agents.service';
import { RunAgentDto, RunAgentResponseDto } from './agents.dto';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('Agents')
@Controller('agents')
@UseGuards(ThrottlerGuard)
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  @Post('run')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Run the AI agent with a natural-language prompt' })
  @ApiBody({ type: RunAgentDto })
  @ApiResponse({ status: 200, type: RunAgentResponseDto, description: 'Agent answer' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  @ApiResponse({ status: 500, description: 'Agent failed to produce an answer' })
  async run(@Body() body: RunAgentDto): Promise<RunAgentResponseDto> {
    const result = await this.agentsService.run(body.prompt);
    return { result };
  }
}
