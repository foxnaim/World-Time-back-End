import { Module } from '@nestjs/common';

import { PrismaModule } from '@/common/prisma.module';
import { AnalyticsModule } from '@/modules/analytics/analytics.module';
import { CompanyAdminGuard } from '@/modules/analytics/guards/company-admin.guard';
import { CompanyRoleGuard } from '@/modules/company/guards/company-role.guard';

import { PayrollService } from './payroll.service';
import { PayrollController, ReportController } from './report.controller';
import { ReportService } from './report.service';
import { TimesheetController } from './timesheet.controller';
import { TimesheetService } from './timesheet.service';

/**
 * ReportModule — PDF generation for B2B monthly attendance reports and B2C
 * freelance invoices, plus the monthly payroll estimate endpoint.
 *
 * Depends on AnalyticsModule for the billable-hours breakdown so invoice
 * figures match the on-screen dashboard exactly.
 *
 * CompanyAdminGuard / CompanyRoleGuard are registered here as providers so the
 * controllers can use them via @UseGuards; both only need @Global services
 * (PrismaService, Reflector) so there's no duplicate state risk.
 */
@Module({
  imports: [PrismaModule, AnalyticsModule],
  controllers: [ReportController, TimesheetController, PayrollController],
  providers: [ReportService, TimesheetService, PayrollService, CompanyAdminGuard, CompanyRoleGuard],
  exports: [ReportService, PayrollService, TimesheetService],
})
export class ReportModule {}
