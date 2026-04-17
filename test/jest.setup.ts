/**
 * Global Jest setup — runs once per test worker, before any test module is
 * loaded. Lives in `setupFiles` (not `setupFilesAfterEach`) so env vars are
 * populated *before* Nest providers that read them at construction time
 * (e.g. QrService.onModuleInit, AuthService JWT secret lookups) import.
 *
 * We don't rely on real values here — any deterministic fake is enough for
 * HMAC / JWT round-trips in unit tests.
 */
import 'reflect-metadata';

const TEST_ENV_DEFAULTS: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test_worktime?schema=public',
  REDIS_URL: 'redis://localhost:6379/1',
  JWT_SECRET: 'test-jwt-secret-value-for-jest-only',
  JWT_ACCESS_SECRET: 'test-access-secret-value-for-jest',
  JWT_REFRESH_SECRET: 'test-refresh-secret-value-for-jest',
  TELEGRAM_BOT_TOKEN: 'test-telegram-bot-token',
  TELEGRAM_BOT_USERNAME: 'worktime_test_bot',
  QR_HMAC_SECRET: 'test-qr-hmac-secret-16chars-minimum',
  WEB_URL: 'http://localhost:3000',
  API_PORT: '4000',
};

for (const [key, value] of Object.entries(TEST_ENV_DEFAULTS)) {
  if (process.env[key] === undefined || process.env[key] === '') {
    process.env[key] = value;
  }
}
