import { Module } from '@nestjs/common';

import { PrismaModule } from '@/common/prisma.module';
import { EmployeeController } from './employee.controller';
import { EmployeeService } from './employee.service';

/**
 * EmployeeModule
 *
 * Handles per-employee views (my-profile, my-schedule, my-checkins, my-stats).
 *
 * Note: CompanyModule owns InviteTokenService. We resolve it lazily in the
 * controller via ModuleRef to avoid a circular module import. CompanyModule
 * exports InviteTokenService, and both modules are wired up in AppModule.
 */
@Module({
  imports: [PrismaModule],
  controllers: [EmployeeController],
  providers: [EmployeeService],
  exports: [EmployeeService],
})
export class EmployeeModule {}
