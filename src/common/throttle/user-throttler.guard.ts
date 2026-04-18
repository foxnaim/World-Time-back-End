import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';

/**
 * Per-user throttler.
 *
 * The stock `ThrottlerGuard` keys buckets by `req.ip`. That is fine for
 * anonymous traffic but collapses every authed user behind the same
 * corporate NAT into one bucket, causing collateral rate-limiting.
 *
 * We override `getTracker` to key by the authenticated user id when
 * present, falling back to IP for public routes. The `user-` prefix
 * keeps the two namespaces distinct so a user id that happens to match
 * an IP literal can't collide.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Rate limiting is an HTTP concern; Telegraf/RPC contexts have no
    // Express req/res and would crash on `res.header(...)`.
    if (context.getType() !== 'http') {
      return true;
    }
    return super.canActivate(context);
  }

  protected async getTracker(req: Request): Promise<string> {
    const user = (req as Request & { user?: { id?: string } }).user;
    const id = user?.id ?? req.ip;
    return `user-${id}`;
  }
}
