import { z } from 'zod';

export const appConfigSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  JWT_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  QR_HMAC_SECRET: z.string().min(16),
  API_PORT: z.coerce.number().int().positive().default(4000),
  WEB_URL: z.string().url(),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  SENTRY_DSN: z.string().url().optional(),
  METRICS_TOKEN: z.string().optional(),
});

export type AppConfig = z.infer<typeof appConfigSchema>;

export function validate(config: Record<string, unknown>): AppConfig {
  const parsed = appConfigSchema.safeParse(config);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  return parsed.data;
}
