import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { PrismaModule } from '@/common/prisma.module';
import { ReportModule } from '@/modules/report/report.module';
import { SheetsController } from './sheets.controller';
import { SheetsService } from './sheets.service';
import { GoogleOAuthService } from './google-oauth.service';
import { GoogleOAuthController } from './google-oauth.controller';

/**
 * SheetsModule
 *
 * Google Sheets is a one-click export for owners/managers — NOT the
 * source of truth. PrismaModule is imported (it's also @Global() in this
 * app, but we import explicitly for clarity). Exports SheetsService so
 * other modules can trigger an export programmatically if needed.
 */
@Module({
  imports: [PrismaModule, ConfigModule, ReportModule],
  controllers: [SheetsController, GoogleOAuthController],
  providers: [SheetsService, GoogleOAuthService],
  exports: [SheetsService, GoogleOAuthService],
})
export class SheetsModule {}
