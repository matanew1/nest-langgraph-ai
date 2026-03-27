import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ImageAttachmentDto {
  @ApiProperty({
    description:
      'Image URL (https://…) or base64 data URL (data:image/…;base64,…)',
    example: 'data:image/jpeg;base64,/9j/4AAQ...',
  })
  @IsString()
  @Matches(/^(https?:\/\/|data:image\/)/, {
    message: 'url must be an http(s) URL or a data:image/ URL',
  })
  url: string;
}

export class RunAgentDto {
  @ApiProperty({
    description: 'The prompt to send to the AI agent',
    example: 'Search for NestJS best practices',
    maxLength: 100_000,
  })
  @IsString()
  @IsOptional()
  @MaxLength(100_000)
  prompt?: string;

  @ApiProperty({
    description: 'The session ID for continuing a conversation',
    example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef',
    required: false,
  })
  @IsString()
  @IsOptional()
  sessionId?: string;

  @ApiProperty({
    description:
      'Images to pass to the vision-capable LLM (https or data: URLs)',
    required: false,
    type: [ImageAttachmentDto],
  })
  @IsArray()
  @ArrayMaxSize(5)
  @IsOptional()
  images?: ImageAttachmentDto[];
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
    maxLength: 100_000,
  })
  @IsString()
  @IsOptional()
  @MaxLength(100_000)
  prompt?: string;

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

  @ApiProperty({
    description:
      'Images to pass to the vision-capable LLM (https or data: URLs)',
    required: false,
    type: [ImageAttachmentDto],
  })
  @IsArray()
  @ArrayMaxSize(5)
  @IsOptional()
  images?: ImageAttachmentDto[];
}

export class AddMemoryEntryDto {
  @ApiProperty({
    description: 'Memory entry text to add to the session',
    example: 'User prefers TypeScript over JavaScript',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/, {
    message: 'entry must contain at least one non-whitespace character',
  })
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

export class SubmitFeedbackDto {
  @ApiProperty({
    description: 'Feedback rating',
    enum: ['positive', 'negative'],
  })
  @IsIn(['positive', 'negative'])
  @IsString()
  rating: 'positive' | 'negative';

  @ApiProperty({ description: 'Optional comment', required: false })
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  comment?: string;
}

export class FeedbackStatsResponseDto {
  @ApiProperty() sessionId: string;
  @ApiProperty() rating: 'positive' | 'negative' | null;
  @ApiProperty() submittedAt: string | null;
  @ApiProperty() pointsUpdated: number;
}

export class SessionSummaryDto {
  @ApiProperty({ description: 'Session ID' })
  sessionId: string;

  @ApiProperty({
    description: 'ISO timestamp of last activity',
    nullable: true,
  })
  lastActivity: string | null;

  @ApiProperty({ description: 'Last objective or prompt', nullable: true })
  lastObjective: string | null;

  @ApiProperty({ description: 'Number of conversation turns in memory' })
  messageCount: number;
}

export class ListSessionsResponseDto {
  @ApiProperty({ type: [SessionSummaryDto] })
  sessions: SessionSummaryDto[];

  @ApiProperty()
  total: number;
}

export class SessionDetailDto {
  @ApiProperty() sessionId: string;
  @ApiProperty({ type: [String] }) entries: string[];
  @ApiProperty() raw: string;
  @ApiProperty({ nullable: true }) lastInput: string | null;
  @ApiProperty({ nullable: true }) lastObjective: string | null;
  @ApiProperty({ nullable: true }) phase: string | null;
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
    | 'error'
    | 'model_switch';
  data: string;
  sessionId: string;
  step?: number;
  done: boolean;
  /** Active Mistral model name — set on model_switch events. */
  model?: string;
}
