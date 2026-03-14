import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AgentsService } from './agents.service';
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
    status: 200,
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
  async run(@Body() body: RunAgentDto): Promise<RunAgentResponseDto> {
    const result = await this.agentsService.run(body.prompt);
    return { result };
  }

  @Sse('stream')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Stream agent execution as Server-Sent Events' })
  @ApiBody({ type: RunAgentDto })
  @ApiResponse({
    status: 200,
    description: 'SSE stream of agent node events: data: {"node":"<name>","data":{...}}',
  })
  @ApiResponse({
    status: 429,
    type: ErrorResponseDto,
    description: 'Too many requests',
  })
  stream(@Body() body: RunAgentDto): Observable<{ data: string }> {
    return this.agentsService.stream(body.prompt);
  }
}
