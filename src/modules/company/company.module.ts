import { Module } from '@nestjs/common';
import { BillingModule } from '@/modules/billing/billing.module';
import { CompanyController } from './company.controller';
import { CompanyService } from './company.service';
import { InviteTokenService } from './invite-token.service';
import { CompanyRoleGuard } from './guards/company-role.guard';

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
  controllers: [CompanyController],
  providers: [CompanyService, InviteTokenService, CompanyRoleGuard],
  exports: [CompanyService, InviteTokenService],
})
export class CompanyModule {}
