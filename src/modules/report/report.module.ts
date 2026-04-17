import { Module } from '@nestjs/common';

import { PrismaModule } from '@/common/prisma.module';
import { AnalyticsModule } from '@/modules/analytics/analytics.module';
import { CompanyAdminGuard } from '@/modules/analytics/guards/company-admin.guard';

import { ReportController } from './report.controller';
import { ReportService } from './report.service';

/**
 * ReportModule — PDF generation for B2B monthly attendance reports and B2C
 * freelance invoices. Depends on AnalyticsModule for the billable-hours
 * breakdown so invoice figures match the on-screen dashboard exactly.
 *
 * CompanyAdminGuard is also registered here as a provider so the controller
 * can use it via @UseGuards; the class itself only needs PrismaService
 * (which is @Global) so there's no duplicate state risk.
 */
@Module({
  imports: [PrismaModule, AnalyticsModule],
  controllers: [ReportController],
  providers: [ReportService, CompanyAdminGuard],
  exports: [ReportService],
})
export class ReportModule {}
