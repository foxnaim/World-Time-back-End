import { Module } from '@nestjs/common';

import { TelegramModule } from '@/modules/telegram/telegram.module';
import { NotificationService } from './notification.service';
import { AttendanceWatchService } from './attendance-watch.service';

/**
 * Transactional email module + scheduled attendance watchers.
 *
 * - Depends on ConfigModule (registered globally in AppModule) for SMTP_* env
 *   vars and nestjs-pino for structured logging.
 * - Imports TelegramModule so {@link AttendanceWatchService} can inject
 *   BotService for owner notifications. PrismaService is injected directly
 *   (PrismaModule is @Global).
 * - ScheduleModule.forRoot() is wired in AppModule, so @Cron decorators on
 *   AttendanceWatchService are picked up automatically.
 *
 * Any feature module that wants to send transactional email should import
 * NotificationModule and inject {@link NotificationService}.
 */
@Module({
  imports: [TelegramModule],
  providers: [NotificationService, AttendanceWatchService],
  exports: [NotificationService],
})
export class NotificationModule {}
