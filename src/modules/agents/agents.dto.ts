import {
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RunAgentDto {
  @ApiProperty({
    description: 'The prompt to send to the AI agent',
    example: 'Search for NestJS best practices',
    minLength: 1,
    maxLength: 100_000,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(100_000)
  prompt: string;

  @ApiProperty({
    description: 'The session ID for continuing a conversation',
    example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef',
    required: false,
  })
  @IsString()
  @IsOptional()
  sessionId?: string;
}

export class RunAgentResponseDto {
  @ApiProperty({
    description: 'The result returned by the AI agent',
    example: 'Here are some best practices for NestJS: ...',
  })
  result: string;

  @ApiProperty({
    description: 'The session ID for the conversation',
    example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef',
  })
  sessionId: string;
}

export class StreamAgentDto {
  @ApiProperty({
    description: 'The prompt to send to the AI agent for streaming',
    example: 'Search for NestJS best practices',
    minLength: 1,
    maxLength: 100_000,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(100_000)
  prompt: string;

  @ApiProperty({
    description: 'The session ID for continuing a streaming conversation',
    example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef',
    required: false,
  })
  @IsString()
  @IsOptional()
  sessionId?: string;

  @ApiProperty({
    description:
      'Phases in which LLM tokens are streamed to the client. If omitted, streaming is active in all phases.',
    example: ['chat', 'generate'],
    required: false,
    isArray: true,
    type: String,
  })
  @IsIn(['chat', 'generate'], { each: true })
  @IsString({ each: true })
  @IsArray()
  @IsOptional()
  streamPhases?: string[];
}

export class AddMemoryEntryDto {
  @ApiProperty({
    description: 'Memory entry text to add to the session',
    example: 'User prefers TypeScript over JavaScript',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  entry: string;
}

export class SessionMemoryResponseDto {
  @ApiProperty({ description: 'Session ID' })
  sessionId: string;

  @ApiProperty({ description: 'Memory entries (max 3)', type: [String] })
  entries: string[];

  @ApiProperty({ description: 'Raw memory string' })
  raw: string;
}

export interface StreamEventDto {
  type:
    | 'status'
    | 'plan'
    | 'tool_call_started'
    | 'tool_call_finished'
    | 'llm_token'
    | 'llm_stream_reset'
    | 'review_required'
    | 'final'
    | 'error';
  data: string;
  sessionId: string;
  step?: number;
  done: boolean;
}
