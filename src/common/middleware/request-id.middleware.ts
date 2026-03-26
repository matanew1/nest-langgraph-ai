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

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const requestId = (req.headers['x-request-id'] as string) || randomUUID();

    res.setHeader('X-Request-Id', requestId);

    requestContext.run({ requestId }, () => next());
  }
}
