import { Module } from '@nestjs/common';
import { PrismaModule } from '@/common/prisma.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { SuperAdminGuard } from './guards/super-admin.guard';

/**
 * AdminModule — platform super-admin console.
 *
 * PrismaModule is registered as @Global() so the explicit import here is a
 * belt-and-braces, making this module standalone-testable. Intentionally
 * exports nothing: the admin surface is not consumed by other modules.
 */
@Module({
  imports: [PrismaModule],
  controllers: [AdminController],
  providers: [AdminService, SuperAdminGuard],
})
export class AdminModule {}
