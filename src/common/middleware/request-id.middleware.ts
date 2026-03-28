import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { AsyncLocalStorage } from 'async_hooks';

/** AsyncLocalStorage for propagating request ID across async contexts. */
export const requestContext = new AsyncLocalStorage<{ requestId: string }>();

/** Get the current request ID from async context, or undefined if not in a request. */
export function getRequestId(): string | undefined {
  return requestContext.getStore()?.requestId;
}

/** Max length for a client-supplied request ID (UUID is 36 chars). */
const MAX_REQUEST_ID_LENGTH = 64;

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const raw = req.headers['x-request-id'] as string | undefined;

    // Sanitize client-supplied ID: strip newlines/control chars that could
    // pollute structured logs, and cap length to prevent log flooding.
    const requestId =
      raw && raw.trim()
        ? raw.replace(/[\r\n\t\x00-\x1f\x7f]/g, '').slice(0, MAX_REQUEST_ID_LENGTH) ||
          randomUUID()
        : randomUUID();

    res.setHeader('X-Request-Id', requestId);

    requestContext.run({ requestId }, () => next());
  }
}
