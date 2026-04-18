import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

import { BillingService } from '../billing.service';

interface RouteRequest {
  params: Record<string, string>;
}

/**
 * SeatLimitGuard
 *
 * Blocks employee-invite routes once the company has hit its tier seat cap.
 * Reads the companyId from `:id` or `:companyId` route params — mirrors the
 * convention used by CompanyRoleGuard. Attach via @UseGuards on the invite
 * route; see billing/README.md for the recommended wiring.
 */
@Injectable()
export class SeatLimitGuard implements CanActivate {
  constructor(private readonly billing: BillingService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RouteRequest>();
    const companyId = request.params?.id ?? request.params?.companyId ?? undefined;

    if (!companyId) {
      throw new ForbiddenException('Company identifier missing from route params');
    }

    await this.billing.checkSeatAvailable(companyId);
    return true;
  }
}
