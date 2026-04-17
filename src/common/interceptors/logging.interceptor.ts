import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { PinoLogger, InjectPinoLogger } from 'nestjs-pino';
import { Observable, tap } from 'rxjs';
import { Request } from 'express';

/**
 * Most HTTP request/response logging is already handled by `pino-http` inside
 * `LoggerModule`. This interceptor is retained as a thin shim that records
 * handler-level duration through the structured pino logger, so existing
 * `useGlobalInterceptors(new LoggingInterceptor())` wiring in `main.ts`
 * continues to work without emitting `console.log` output.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(
    @InjectPinoLogger(LoggingInterceptor.name)
    private readonly logger: PinoLogger,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const method = request?.method;
    const url = request?.url;
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          this.logger.debug(
            { method, url, durationMs: Date.now() - start },
            'handler completed',
          );
        },
        error: (err: unknown) => {
          this.logger.warn(
            { method, url, durationMs: Date.now() - start, err },
            'handler errored',
          );
        },
      }),
    );
  }
}
