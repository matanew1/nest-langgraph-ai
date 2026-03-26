import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { env } from '@config/env';

/**
 * Guard that validates API key authentication via `Authorization: Bearer <key>`
 * or `x-api-key` header. Skipped when no API_KEY is configured (dev mode).
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    // If no API key is configured, allow all requests (dev mode)
    if (!env.apiKey) return true;

    const request = context.switchToHttp().getRequest();
    const path: string = request.url || request.path || '';

    // Always allow health endpoints without auth
    if (path.startsWith('/health')) return true;

    const authHeader: string | undefined = request.headers['authorization'];
    const apiKeyHeader: string | undefined = request.headers['x-api-key'];

    const token =
      apiKeyHeader ||
      (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined);

    if (!token || token !== env.apiKey) {
      throw new UnauthorizedException('Invalid or missing API key');
    }

    return true;
  }
}
