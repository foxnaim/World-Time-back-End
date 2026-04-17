import { Module } from '@nestjs/common';
import { CompanyController } from './company.controller';
import { CompanyService } from './company.service';
import { InviteTokenService } from './invite-token.service';
import { CompanyRoleGuard } from './guards/company-role.guard';

/**
 * CompanyModule
 *
 * PrismaModule is registered as @Global() elsewhere in the app, so we do not
 * need to import it explicitly here — PrismaService is injected directly.
 */
@Module({
  controllers: [CompanyController],
  providers: [CompanyService, InviteTokenService, CompanyRoleGuard],
  exports: [CompanyService, InviteTokenService],
})
export class CompanyModule {}
