import { applyDecorators, HttpStatus } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { ErrorResponseDto } from '@common/dto/error-response.dto';

interface StandardDeleteResponseOptions {
  description?: string;
}

export function ApiStandardDeleteResponse(options?: StandardDeleteResponseOptions) {
  return applyDecorators(
    ApiResponse({
      status: HttpStatus.NO_CONTENT,
      description: options?.description || 'Resource deleted successfully',
    }),
    ApiResponse({
      status: HttpStatus.NOT_FOUND,
      description: 'Resource not found',
    }),
    ApiResponse({
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      type: ErrorResponseDto,
      description: 'Internal server error',
    }),
  );
}