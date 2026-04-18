import { INestApplication, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import pkg from '../../package.json';

/**
 * Module tags surfaced in the Swagger UI. Keep this list in sync with
 * the @ApiTags(...) decorator used on each controller.
 */
const MODULE_TAGS: Array<{ name: string; description: string }> = [
  { name: 'auth', description: 'Telegram login, JWT refresh, session (/auth/me)' },
  { name: 'companies', description: 'Company + employee management (B2B)' },
  { name: 'employees', description: 'Employee profile and membership' },
  { name: 'checkin', description: 'QR rotation, scans, SSE stream, history' },
  { name: 'projects', description: 'Freelancer projects (B2C)' },
  { name: 'time-entries', description: 'Freelancer timer / manual sessions (B2C)' },
  { name: 'analytics', description: 'B2B late/ranking/overtime + B2C hourly rate' },
  { name: 'sheets', description: 'Google Sheets monthly export' },
  { name: 'health', description: 'Liveness / readiness probes' },
];

/**
 * Decide whether Swagger UI should be enabled for this process.
 *
 * We always enable outside production, and additionally honour an explicit
 * opt-in flag so that staging/prod can expose docs behind infra auth without
 * rebuilding the image.
 */
function shouldEnableSwagger(): boolean {
  if (process.env.ENABLE_SWAGGER === 'true') return true;
  return process.env.NODE_ENV !== 'production';
}

/**
 * Mount the OpenAPI / Swagger UI at `/api/docs`.
 *
 * Call after `app.setGlobalPrefix('api')` so the path shown in the UI
 * matches the real routes. Safe to call unconditionally — when disabled
 * (prod without opt-in) this is a no-op.
 */
export function setupSwagger(app: INestApplication): void {
  if (!shouldEnableSwagger()) {
    return;
  }

  const logger = new Logger('Swagger');
  const port = Number(process.env.API_PORT ?? 4000);
  const version = pkg.version ?? '0.0.0';

  const builder = new DocumentBuilder()
    .setTitle('Work Tact API')
    .setDescription('Work Tact API — Telegram+QR time tracking for B2B offices and B2C freelancers')
    .setVersion(version)
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'jwt')
    .addServer(`http://localhost:${port}`, 'local');

  for (const tag of MODULE_TAGS) {
    builder.addTag(tag.name, tag.description);
  }

  const config = builder.build();

  const document = SwaggerModule.createDocument(app, config, {
    extraModels: [],
  });

  SwaggerModule.setup('api/docs', app, document, {
    customSiteTitle: 'Work Tact API',
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  logger.log(`Swagger UI mounted at /api/docs (version ${version})`);
}
