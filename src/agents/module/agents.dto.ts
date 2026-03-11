import { IsNotEmpty, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RunAgentDto {
  @ApiProperty({
    description: 'The prompt to send to the AI agent',
    example: 'Search for NestJS best practices',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  prompt: string;
}

export class RunAgentResponseDto {
  @ApiProperty({
    description: 'The result returned by the AI agent',
    example: 'Here are some best practices for NestJS: ...',
  })
  result: string | undefined;
}
