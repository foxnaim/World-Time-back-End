import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';

import { validate } from './common/config';
import { PrismaModule } from './common/prisma.module';
import { RedisModule } from './common/redis/redis.module';
import { RedisService } from './common/redis/redis.service';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { SentryModule } from './common/filters/sentry.filter';
import { LoggerModule, CorrelationMiddleware } from './common/logger';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { UserThrottlerGuard } from './common/throttle/user-throttler.guard';
import { RedisThrottlerStorage } from './common/throttle/redis-throttler.storage';

import { AuthModule } from './modules/auth/auth.module';
import { CompanyModule } from './modules/company/company.module';
import { EmployeeModule } from './modules/employee/employee.module';
import { CheckinModule } from './modules/checkin/checkin.module';
import { ProjectModule } from './modules/project/project.module';
import { TimeEntryModule } from './modules/time-entry/time-entry.module';
import { TelegramModule } from './modules/telegram/telegram.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { SheetsModule } from './modules/sheets/sheets.module';
import { HealthModule } from './modules/health/health.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { NotificationModule } from './modules/notification/notification.module';
import { BillingModule } from './modules/billing/billing.module';
import { ReportModule } from './modules/report/report.module';
import { AdminModule } from './modules/admin/admin.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
    }),
    LoggerModule,
    // Throttler uses a Redis-backed storage when REDIS_URL is configured so
    // buckets are shared across instances; the storage transparently falls
    // back to an in-memory Map when RedisService reports degraded.
    ThrottlerModule.forRootAsync({
      inject: [RedisService],
      useFactory: (redis: RedisService) => ({
        throttlers: [{ ttl: 60_000, limit: 60 }],
        storage: new RedisThrottlerStorage(redis),
      }),
    }),
    ScheduleModule.forRoot(),
    SentryModule,
    RedisModule,
    PrismaModule,
    AuthModule,
    CompanyModule,
    EmployeeModule,
    CheckinModule,
    ProjectModule,
    TimeEntryModule,
    TelegramModule,
    AnalyticsModule,
    SheetsModule,
    HealthModule,
    MetricsModule,
    NotificationModule,
    BillingModule,
    ReportModule,
    AdminModule,
  ],
  providers: [
    {
      // Per-user (falls back to per-IP) throttler. See common/throttle/README.md
      provide: APP_GUARD,
      useClass: UserThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    LoggingInterceptor,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
