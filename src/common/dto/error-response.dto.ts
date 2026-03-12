import { ApiProperty } from '@nestjs/swagger';

export class ErrorResponseDto {
  @ApiProperty({ example: 500 })
  statusCode: number;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: '/agents/run' })
  path: string;

  @ApiProperty({ example: 'Internal server error' })
  message: string | object;
}
