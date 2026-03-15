import { applyDecorators, HttpStatus, Type } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { ErrorResponseDto } from '@common/dto/error-response.dto';

interface StandardResponseOptions<T> {
  type?: Type<T>;
  description?: string;
  status?: HttpStatus;
}

export function ApiStandardResponse<T>(options: StandardResponseOptions<T>) {
  return applyDecorators(
    ApiResponse({
      status: options.status || HttpStatus.OK,
      type: options.type,
      description: options.description || 'Successful operation',
    }),
    ApiResponse({
      status: HttpStatus.BAD_REQUEST,
      type: ErrorResponseDto,
      description: 'Invalid request',
    }),
    ApiResponse({
      status: HttpStatus.TOO_MANY_REQUESTS,
      type: ErrorResponseDto,
      description: 'Too many requests',
    }),
    ApiResponse({
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      type: ErrorResponseDto,
      description: 'Internal server error',
    }),
  );
}