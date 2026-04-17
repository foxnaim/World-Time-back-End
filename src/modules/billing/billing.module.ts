import { Module } from '@nestjs/common';

import { PrismaModule } from '@/common/prisma.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { SeatLimitGuard } from './guards/seat-limit.guard';

/**
 * BillingModule
 *
 * Owns the Subscription row per Company and the tier feature matrix. Real
 * payment provider integration (Stripe / YooKassa) is intentionally left
 * as TODO stubs on the controller. PrismaModule is @Global() in this app
 * but we import it explicitly for clarity.
 */
@Module({
  imports: [PrismaModule],
  controllers: [BillingController],
  providers: [BillingService, SeatLimitGuard],
  exports: [BillingService, SeatLimitGuard],
})
export class BillingModule {}
