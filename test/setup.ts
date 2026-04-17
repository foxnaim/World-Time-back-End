/**
 * Global Jest setup — runs once per test worker before any spec files load.
 *
 * Responsibilities:
 *   1. Pull in `reflect-metadata` so Nest DI decorators work under Jest.
 *   2. Stub environment variables required by modules that read from
 *      ConfigService at construction time (e.g. QrService.onModuleInit,
 *      AuthService JWT secrets). Real values are not needed for unit tests;
 *      deterministic fakes are sufficient for HMAC/JWT round-trips.
 */
import 'reflect-metadata';

// eslint-disable-next-line @typescript-eslint/no-misused-promises
beforeAll(() => {
  const defaults: Record<string, string> = {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test?schema=public',
    TELEGRAM_BOT_TOKEN: 'test-telegram-bot-token',
    JWT_ACCESS_SECRET: 'test-access-secret-value-for-jest',
    JWT_REFRESH_SECRET: 'test-refresh-secret-value-for-jest',
    QR_HMAC_SECRET: 'test-qr-hmac-secret-16chars-minimum',
    WEB_URL: 'http://localhost:3000',
    API_PORT: '4000',
  };

  for (const [key, value] of Object.entries(defaults)) {
    if (process.env[key] === undefined || process.env[key] === '') {
      process.env[key] = value;
    }
  }
});
