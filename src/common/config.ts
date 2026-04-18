import { z } from 'zod';

const isProd = process.env.NODE_ENV === 'production';

// Accept empty strings from .env.example placeholders in dev; require in prod.
const devOrProdString = (minLen: number) =>
  isProd ? z.string().min(minLen) : z.string().optional().default('');

const devOrProdUrl = () => (isProd ? z.string().url() : z.string().min(1));

// SENTRY_DSN: accept empty/unset OR a valid URL. Never fail dev on this.
const optionalUrl = z
  .string()
  .optional()
  .transform((v) => (v && v.trim().length > 0 ? v : undefined))
  .pipe(z.string().url().optional());

export const appConfigSchema = z.object({
  DATABASE_URL: devOrProdUrl(),
  REDIS_URL: devOrProdUrl(),
  TELEGRAM_BOT_TOKEN: devOrProdString(1),
  JWT_SECRET: devOrProdString(16),
  JWT_ACCESS_SECRET: z.string().optional(),
  JWT_REFRESH_SECRET: devOrProdString(16),
  QR_HMAC_SECRET: devOrProdString(16),
  API_PORT: z.coerce.number().int().positive().default(4000),
  WEB_URL: devOrProdUrl(),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  SENTRY_DSN: optionalUrl,
  METRICS_TOKEN: z.string().optional(),
});

export type AppConfig = z.infer<typeof appConfigSchema>;

export function validate(config: Record<string, unknown>): AppConfig {
  const parsed = appConfigSchema.safeParse(config);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }

  const data = parsed.data;

  // Dev-only fallbacks so backend can boot without real secrets.
  if (!isProd) {
    if (!data.JWT_SECRET) data.JWT_SECRET = 'dev-jwt-secret-change-me-please-32b';
    if (!data.JWT_ACCESS_SECRET) data.JWT_ACCESS_SECRET = data.JWT_SECRET;
    if (!data.JWT_REFRESH_SECRET) data.JWT_REFRESH_SECRET = 'dev-jwt-refresh-change-me-please-32b';
    if (!data.QR_HMAC_SECRET) data.QR_HMAC_SECRET = 'dev-qr-hmac-change-me-please-32b-ok';
    if (!data.TELEGRAM_BOT_TOKEN) data.TELEGRAM_BOT_TOKEN = '';
    if (!data.DATABASE_URL)
      data.DATABASE_URL = 'postgres://worktime:worktime@localhost:5432/worktime';
    if (!data.REDIS_URL) data.REDIS_URL = 'redis://localhost:6379';
    if (!data.WEB_URL) data.WEB_URL = 'http://localhost:3000';
  }

  return data;
}
