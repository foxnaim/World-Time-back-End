import { Module } from '@nestjs/common';

import { PrismaModule } from '@/common/prisma.module';
import { RedisModule } from '@/common/redis/redis.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { FreelancerBillingController } from './freelancer-billing.controller';
import { FreelancerBillingService } from './freelancer-billing.service';
import { FxService } from './fx.service';
import { LatePenaltyService } from './late-penalty.service';
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
  imports: [PrismaModule, RedisModule],
  controllers: [BillingController, FreelancerBillingController],
  providers: [BillingService, FreelancerBillingService, FxService, LatePenaltyService, SeatLimitGuard],
  exports: [BillingService, FreelancerBillingService, LatePenaltyService, SeatLimitGuard],
})
export class BillingModule {}
