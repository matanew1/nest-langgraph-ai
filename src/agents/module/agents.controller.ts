import { Body, Controller, Post } from '@nestjs/common';
import { AgentsService } from './agents.service';
import { RunAgentDto, RunAgentResponseDto } from './agents.dto';
import {
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

@ApiTags('Agents')
@Controller('agents')
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  @Post('run')
  @ApiOperation({ summary: 'Run the AI agent with a prompt' })
  @ApiBody({ type: RunAgentDto })
  @ApiResponse({ status: 200, description: 'The result of the agent'})
  @ApiResponse({ status: 400, description: 'Invalid request' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async run(@Body() body: RunAgentDto): Promise<RunAgentResponseDto> {
    // run the agent
    const result = await this.agentsService.run(body.prompt);
    // return the result
    return { result };
  }
}
