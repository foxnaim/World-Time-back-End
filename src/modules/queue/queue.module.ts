import { Global, Module, forwardRef } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';

import { NotificationModule } from '@/modules/notification/notification.module';
import { SheetsModule } from '@/modules/sheets/sheets.module';
import { ReportModule } from '@/modules/report/report.module';

import { QUEUES } from './queues';
import { QueueService } from './queue.service';
import { EmailProcessor } from './processors/email.processor';
import { SheetsExportProcessor } from './processors/sheets-export.processor';
import { PdfReportProcessor } from './processors/pdf-report.processor';

/**
 * QueueModule — central BullMQ wiring.
 *
 * Connection is parsed from REDIS_URL at app bootstrap. When REDIS_URL is
 * unset we still register the BullModule with a dummy `enabled: false` flag
 * so Nest DI is happy, but {@link QueueService} checks the flag and runs
 * every "enqueue" call inline (sync fallback) so the app remains usable in
 * CI, local dev, and any env without a Redis broker.
 *
 * Marked @Global so any feature module can `inject(QueueService)` without
 * each re-importing QueueModule (we still export BullModule re-exports
 * for advanced consumers who want to register their own queues).
 */
@Global()
@Module({
  imports: [
    // Root BullMQ connection — parse REDIS_URL lazily via ConfigService.
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = config.get<string>('REDIS_URL')?.trim();
        // Even without a URL we must return a shape BullModule accepts;
        // QueueService will short-circuit enqueue() before BullMQ ever
        // tries to connect.
        if (!url) {
          return {
            connection: {
              host: '127.0.0.1',
              port: 6379,
              // lazyConnect keeps ioredis from actually dialing out when
              // the queue is never used — critical for the sync-fallback
              // path. BullMQ respects this option on the underlying client.
              lazyConnect: true,
              // Drop retries to zero so a misconfigured env doesn't log
              // reconnect loops forever.
              maxRetriesPerRequest: null,
              enableReadyCheck: false,
            },
          };
        }
        try {
          const parsed = new URL(url);
          const port = parsed.port ? Number(parsed.port) : 6379;
          const db = parsed.pathname && parsed.pathname.length > 1
            ? Number(parsed.pathname.slice(1)) || 0
            : 0;
          return {
            connection: {
              host: parsed.hostname,
              port,
              password: parsed.password
                ? decodeURIComponent(parsed.password)
                : undefined,
              username: parsed.username
                ? decodeURIComponent(parsed.username)
                : undefined,
              db,
              // BullMQ requires maxRetriesPerRequest: null on the shared
              // connection — see https://docs.bullmq.io/guide/connections
              maxRetriesPerRequest: null,
              enableReadyCheck: false,
            },
          };
        } catch {
          // Malformed REDIS_URL — fall back to a disabled-looking config.
          return {
            connection: {
              host: '127.0.0.1',
              port: 6379,
              lazyConnect: true,
              maxRetriesPerRequest: null,
              enableReadyCheck: false,
            },
          };
        }
      },
    }),
    BullModule.registerQueueAsync(
      { name: QUEUES.EMAIL },
      { name: QUEUES.SHEETS_EXPORT },
      { name: QUEUES.PDF_REPORT },
    ),

    // forwardRef to break the cycle: NotificationService injects QueueService
    // (enqueueEmail) and EmailProcessor needs NotificationService to deliver
    // once the job fires.
    forwardRef(() => NotificationModule),
    forwardRef(() => SheetsModule),
    forwardRef(() => ReportModule),
  ],
  providers: [
    QueueService,
    EmailProcessor,
    SheetsExportProcessor,
    PdfReportProcessor,
  ],
  exports: [QueueService, BullModule],
})
export class QueueModule {}

export { QUEUES } from './queues';
