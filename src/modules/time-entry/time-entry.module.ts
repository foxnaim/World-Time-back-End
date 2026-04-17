import { Module } from '@nestjs/common';

import { TimeEntryController } from './time-entry.controller';
import { TimeEntryService } from './time-entry.service';

/**
 * TimeEntryModule
 *
 * PrismaModule is @Global(), so PrismaService is injected directly without
 * an explicit import. Ownership of projects is verified inside the service
 * via Project.userId, so we don't need to import ProjectModule here.
 */
@Module({
  controllers: [TimeEntryController],
  providers: [TimeEntryService],
  exports: [TimeEntryService],
})
export class TimeEntryModule {}
