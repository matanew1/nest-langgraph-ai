import {
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
    maxLength: 4000,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(4000)
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
    maxLength: 4000,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(4000)
  prompt: string;

  @ApiProperty({
    description: 'The session ID for continuing a streaming conversation',
    example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef',
    required: false,
  })
  @IsString()
  @IsOptional()
  sessionId?: string;
}

export interface StreamEventDto {
  type: 'step' | 'tool_call' | 'chunk' | 'final' | 'error';
  data: string;
  sessionId: string;
  step?: number;
  done: boolean;
}
