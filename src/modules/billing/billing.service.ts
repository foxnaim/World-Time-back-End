import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Subscription, SubscriptionTier } from '@prisma/client';

import { PrismaService } from '@/common/prisma.service';
import { TIERS, TierFeatures } from './tier-config';

/**
 * BillingService
 *
 * Owns the Subscription row per Company and the read-side of the feature
 * matrix. Payment provider integration (Stripe / YooKassa) is deliberately
 * absent — the controller exposes stub endpoints and this service just
 * tracks the tier/status/seatsLimit locally. Swap the stubs for real
 * providers once commercial terms are signed.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Fetches the subscription for a company, or null if none has been provisioned yet. */
  async getSubscription(companyId: string): Promise<Subscription | null> {
    return this.prisma.subscription.findUnique({ where: { companyId } });
  }

  /** Returns the feature matrix for a given tier. */
  getEffectiveLimits(tier: SubscriptionTier): TierFeatures {
    return TIERS[tier];
  }

  /**
   * Throws ForbiddenException if the company is at or over its seat cap.
   * Called by SeatLimitGuard before allowing a new employee invite.
   */
  async checkSeatAvailable(companyId: string): Promise<void> {
    const sub = await this.getSubscription(companyId);
    // If no subscription yet, fall back to FREE defaults rather than blocking
    // entirely — new companies may race the subscription provisioning step.
    const seatsLimit = sub?.seatsLimit ?? TIERS.FREE.seatsLimit;

    const current = await this.prisma.employee.count({
      where: { companyId, status: 'ACTIVE' },
    });

    if (current >= seatsLimit) {
      throw new ForbiddenException('Достигнут лимит сотрудников на текущем тарифе');
    }
  }

  /**
   * Creates a default FREE-tier subscription for a freshly created company.
   *
   * TODO: invoke from CompanyService.create. Per module scope this agent
   * does not edit CompanyService — see billing/README.md for the integration
   * point.
   */
  async createDefaultFreeSubscription(companyId: string): Promise<Subscription> {
    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    return this.prisma.subscription.create({
      data: {
        companyId,
        tier: 'FREE',
        status: 'ACTIVE',
        seatsLimit: TIERS.FREE.seatsLimit,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
      },
    });
  }
}
