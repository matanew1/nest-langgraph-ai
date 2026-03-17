import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const now = Date.now();
    const httpContext = context.switchToHttp();
    const request = httpContext.getRequest();
    const { method, url, ip } = request;
    const controllerName = context.getClass().name;
    const handlerName = context.getHandler().name;

    // Log the incoming request
    this.logger.log(`Incoming Request: ${method} ${url} from ${ip} [${controllerName}.${handlerName}]`);

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - now;
          this.logger.log(
            `Request Completed: ${method} ${url} - ${duration}ms [${controllerName}.${handlerName}]`,
          );
        },
        error: (err) => {
          const duration = Date.now() - now;
          this.logger.error(
            `Request Failed: ${method} ${url} - ${duration}ms [${controllerName}.${handlerName}] - Error: ${err.message}`,
          );
        },
      }),
    );
  }
}
