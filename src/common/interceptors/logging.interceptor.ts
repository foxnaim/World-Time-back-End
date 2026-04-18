import { CallHandler, ExecutionContext, Injectable, NestInterceptor, Logger } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { Request } from 'express';

/**
 * Most HTTP request/response logging is handled by `pino-http` via LoggerModule.
 * This interceptor adds per-handler timing using the global Nest Logger, which
 * nestjs-pino re-routes through structured pino output.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // Skip non-HTTP contexts (Telegraf, WS) — no Express request to read.
    if (context.getType() !== 'http') {
      return next.handle();
    }
    const request = context.switchToHttp().getRequest<Request>();
    const method = request?.method;
    const url = request?.url;
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          this.logger.debug(`handler completed ${method} ${url} ${Date.now() - start}ms`);
        },
        error: (err: unknown) => {
          this.logger.warn(
            `handler errored ${method} ${url} ${Date.now() - start}ms: ${
              (err as Error)?.message ?? err
            }`,
          );
        },
      }),
    );
  }
}
