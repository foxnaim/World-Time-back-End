import * as Sentry from '@sentry/nestjs';

const dsn = process.env.SENTRY_DSN;

export const sentryEnabled = Boolean(dsn && dsn.length > 0);

if (sentryEnabled) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    profilesSampleRate: 0.0,
    environment: process.env.NODE_ENV,
    integrations: [Sentry.httpIntegration(), Sentry.prismaIntegration()],
  });
}
