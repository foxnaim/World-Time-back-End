import { ArgumentsHost, Catch, ExceptionFilter, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import * as Sentry from '@sentry/nestjs';

import { sentryEnabled } from '../../instrument';

@Catch()
export class SentryFilter implements ExceptionFilter {
  catch(exception: unknown, _host: ArgumentsHost): void {
    if (sentryEnabled) {
      Sentry.captureException(exception);
    }
    // Rethrow so the existing HttpExceptionFilter handles the response shape.
    throw exception;
  }
}

@Module({
  providers: [
    {
      provide: APP_FILTER,
      useClass: SentryFilter,
    },
  ],
})
export class SentryModule {}
