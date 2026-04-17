import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { PrismaModule } from '@/common/prisma.module';
import { SheetsController } from './sheets.controller';
import { SheetsService } from './sheets.service';

/**
 * SheetsModule
 *
 * Google Sheets is a one-click export for owners/managers — NOT the
 * source of truth. PrismaModule is imported (it's also @Global() in this
 * app, but we import explicitly for clarity). Exports SheetsService so
 * other modules can trigger an export programmatically if needed.
 */
@Module({
  imports: [PrismaModule, ConfigModule],
  controllers: [SheetsController],
  providers: [SheetsService],
  exports: [SheetsService],
})
export class SheetsModule {}
