import { Module } from '@nestjs/common';

import { NotificationService } from './notification.service';

/**
 * Transactional email module. Depends on ConfigModule (registered globally
 * in AppModule) for SMTP_* env vars and nestjs-pino for structured logging.
 *
 * Any feature module that wants to send transactional email should import
 * NotificationModule and inject {@link NotificationService}.
 */
@Module({
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
