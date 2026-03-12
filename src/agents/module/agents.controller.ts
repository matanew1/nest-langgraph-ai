import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AgentsService } from './agents.service';
import { RunAgentDto, RunAgentResponseDto } from './agents.dto';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';

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

  @Post('stream')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Stream agent execution as Server-Sent Events' })
  @ApiBody({ type: RunAgentDto })
  @ApiResponse({ status: 200, description: 'SSE stream of node updates' })
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
  async stream(@Body() body: RunAgentDto, @Res() res: Response): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    try {
      for await (const event of this.agentsService.stream(body.prompt)) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } finally {
      res.end();
    }
  }
}
