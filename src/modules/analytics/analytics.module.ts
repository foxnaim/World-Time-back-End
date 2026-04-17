import { Module } from '@nestjs/common';

import { PrismaModule } from '@/common/prisma.module';

import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { CompanyAdminGuard } from './guards/company-admin.guard';

/**
 * AnalyticsModule
 *
 * Aggregations over CheckIn + TimeEntry data used by:
 *   - B2B dashboards (late stats, ranking, overtime, summary)
 *   - B2C dashboards (real hourly rate, per-project rate history)
 *
 * PrismaModule is @Global, but we import it explicitly so the module is
 * self-describing and happy in isolated tests.
 */
@Module({
  imports: [PrismaModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, CompanyAdminGuard],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
