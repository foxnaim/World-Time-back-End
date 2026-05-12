import { Module } from '@nestjs/common';
import { BillingModule } from '@/modules/billing/billing.module';
import { BotService } from '@/modules/telegram/bot.service';
import { CompanyController } from './company.controller';
import { CompanyService } from './company.service';
import { InviteTokenService } from './invite-token.service';
import { CompanyRoleGuard } from './guards/company-role.guard';
import { LocationController } from './locations/location.controller';
import { LocationService } from './locations/location.service';
import { DepartmentController } from './departments/department.controller';
import { DepartmentService } from './departments/department.service';
import { ShiftController } from './shifts/shift.controller';
import { ShiftService } from './shifts/shift.service';
import { AbsenceController } from './absences/absence.controller';
import { AbsenceService } from './absences/absence.service';
import { ActivityService } from '@/modules/checkin/activity.service';

/**
 * CompanyModule
 *
 * PrismaModule is registered as @Global() elsewhere in the app, so we do not
 * need to import it explicitly here — PrismaService is injected directly.
 * BillingModule is imported so CompanyService can provision a default FREE
 * subscription on Company.create.
 */
@Module({
  imports: [BillingModule],
  controllers: [CompanyController, LocationController, DepartmentController, ShiftController, AbsenceController],
  providers: [CompanyService, InviteTokenService, CompanyRoleGuard, BotService, LocationService, DepartmentService, ShiftService, AbsenceService, ActivityService],
  exports: [CompanyService, InviteTokenService],
})
export class CompanyModule {}
