import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SubscriptionTier } from '@prisma/client';

import { PrismaService } from '@/common/prisma.service';
import { Public } from '@/common/decorators/public.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';

import { BillingService } from './billing.service';
import { FxService } from './fx.service';
import { TIERS } from './tier-config';

interface CheckoutBody {
  companyId?: string;
  tier?: SubscriptionTier;
}

/**
 * BillingController
 *
 * Exposes read access to the subscription + feature matrix for the owner,
 * a stubbed checkout endpoint, and a webhook landing pad. All payment
 * provider plumbing is intentionally stubbed out — see README.md.
 */
@Controller('billing')
@UseGuards(AuthGuard('jwt'))
export class BillingController {
  private readonly logger = new Logger(BillingController.name);

  constructor(
    private readonly billing: BillingService,
    private readonly prisma: PrismaService,
    private readonly fx: FxService,
  ) {}

  /**
   * Current FX rates vs RUB. Public (anyone who can load a billing page
   * needs this) but still behind the JWT guard because non-auth users
   * don't have a billing page to render.
   */
  @Get('fx')
  getRates() {
    return this.fx.current();
  }

  /**
   * Read-only billing view. Allowed for the company owner (checked against
   * Company.ownerId directly so it stays usable even if the employee record
   * is missing during onboarding) and for ACCOUNTANT employees.
   */
  @Get('my/:companyId')
  async mySubscription(@Param('companyId') companyId: string, @CurrentUser() user: { id: string }) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, ownerId: true },
    });
    if (!company) {
      throw new NotFoundException('Company not found');
    }
    if (company.ownerId !== user.id) {
      const membership = await this.prisma.employee.findFirst({
        where: {
          companyId,
          userId: user.id,
          status: 'ACTIVE',
          role: { in: ['OWNER', 'MANAGER', 'ACCOUNTANT'] },
        },
        select: { id: true },
      });
      if (!membership) {
        throw new ForbiddenException('Only the company owner or an accountant may view billing');
      }
    }

    let subscription = await this.billing.getSubscription(companyId);
    if (!subscription) {
      this.logger.log(`no subscription for company=${companyId}, auto-creating FREE`);
      subscription = await this.billing.createDefaultFreeSubscription(companyId);
    }

    const tierLimits = this.billing.getEffectiveLimits(subscription.tier);

    const currentSeats = await this.prisma.employee.count({
      where: { companyId, status: 'ACTIVE' },
    });

    return {
      subscription: {
        tier: subscription.tier,
        status: subscription.status,
        seatsLimit: subscription.seatsLimit,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
      },
      limits: {
        seatsLimit: subscription.seatsLimit,
        sheetsExport: tierLimits.sheetsExport,
        monthlyReports: tierLimits.monthlyReports,
      },
      currentSeats,
    };
  }

  /**
   * Stub checkout — returns a fake session URL. Hooks for YooKassa /
   * Stripe live here.
   *
   * TODO: integrate YooKassa
   *   1. Create payment in provider with idempotency-key = companyId+period.
   *   2. Persist external session ID on the Subscription row.
   *   3. Return the provider-hosted checkout URL instead of the stub.
   */
  @Post('checkout')
  @HttpCode(HttpStatus.OK)
  async checkout(@Body() body: CheckoutBody, @CurrentUser() user: { id: string }) {
    const companyId = body?.companyId;
    const tier = body?.tier;
    if (!companyId || !tier || !(tier in TIERS)) {
      throw new NotFoundException('companyId and valid tier are required');
    }

    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { ownerId: true },
    });
    if (!company || company.ownerId !== user.id) {
      throw new ForbiddenException('Only the company owner may start checkout');
    }

    const sessionId = `stub_${companyId}_${tier}_${Date.now()}`;
    this.logger.log(`checkout stub created session=${sessionId} tier=${tier} company=${companyId}`);

    return {
      checkoutUrl: `/billing/stub?session=${sessionId}`,
      external: false,
    };
  }

  /**
   * Change tier without going through payment (demo).
   *
   * Owner-only. The service guards the downgrade case (can't go below
   * current headcount). Once a real payment provider is wired up, upgrades
   * should route through checkout instead of calling this directly.
   */
  @Post(':companyId/change-tier')
  @HttpCode(HttpStatus.OK)
  async changeTier(
    @Param('companyId') companyId: string,
    @Body() body: { tier?: SubscriptionTier },
    @CurrentUser() user: { id: string },
  ) {
    if (!body?.tier || !(body.tier in TIERS)) {
      throw new NotFoundException('Valid tier is required');
    }
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { ownerId: true },
    });
    if (!company) throw new NotFoundException('Company not found');
    if (company.ownerId !== user.id) {
      throw new ForbiddenException('Only the company owner may change tier');
    }

    const subscription = await this.billing.changeTier(companyId, body.tier);
    return {
      ok: true,
      subscription: {
        tier: subscription.tier,
        status: subscription.status,
        seatsLimit: subscription.seatsLimit,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
      },
    };
  }

  /**
   * Webhook landing pad. Returns 200 so providers don't retry while we
   * develop the integration.
   *
   * TODO:
   *   - Verify the provider's HMAC signature from the request header.
   *   - Parse event type (payment.succeeded / subscription.canceled / ...).
   *   - Update Subscription.status + currentPeriodEnd accordingly.
   *   - Make the handler idempotent via externalId + event id.
   */
  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  webhook(@Body() body: unknown) {
    this.logger.log(`billing webhook received payload=${JSON.stringify(body)?.slice(0, 500)}`);
    return { received: true };
  }
}
