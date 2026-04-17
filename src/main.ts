import './instrument';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import compression from 'compression';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { helmetConfig } from './common/security/helmet.config';
import { setupSwagger } from './common/swagger';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  app.useLogger(app.get(Logger));

  // Security headers (HSTS, frameguard, nosniff, referrer policy).
  // Applied before CORS so preflight OPTIONS responses also carry them.
  app.use(helmet(helmetConfig));

  // Gzip responses. Nginx in front of us usually does this too, but
  // keeping it on in the app protects local dev and direct-to-node setups.
  app.use(compression());

  const allowedOrigins = [process.env.WEB_URL, process.env.ADMIN_URL].filter(
    (origin): origin is string => typeof origin === 'string' && origin.length > 0,
  );

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'X-Request-Id',
      'X-Display-Key',
    ],
  });

  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(app.get(LoggingInterceptor));

  setupSwagger(app);

  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port);

  const logger = app.get(Logger);
  logger.log(`API ready on :${port}`, 'Bootstrap');
  logger.log(`Swagger: http://localhost:${port}/api/docs`, 'Bootstrap');
}

void bootstrap();
