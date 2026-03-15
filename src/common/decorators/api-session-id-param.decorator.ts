import { ApiParam } from '@nestjs/swagger';

export function ApiSessionIdParam() {
  return ApiParam({
    name: 'sessionId',
    type: 'string',
    description: 'The unique session identifier (UUID)',
    example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef',
  });
}