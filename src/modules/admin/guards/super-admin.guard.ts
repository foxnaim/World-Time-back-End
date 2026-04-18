import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';

/**
 * Parse a comma-separated list of telegram IDs from env into a BigInt set.
 * Silently drops entries that can't be parsed.
 */
function parseSuperAdminIds(raw: string | undefined): Set<bigint> {
  if (!raw) return new Set();
  const out = new Set<bigint>();
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    try {
      out.add(BigInt(trimmed));
    } catch {
      // ignore malformed entries
    }
  }
  return out;
}

interface AuthedRequest {
  user?: { id: string; telegramId?: string | bigint | null } | null;
}

/**
 * Gate-keeper for the platform super-admin console. Allows only Telegram IDs
 * present in the `SUPER_ADMIN_TELEGRAM_IDS` environment variable
 * (comma-separated). Parsed lazily on each request so ops can update the env
 * and restart without code changes.
 *
 * Intended to run AFTER JwtAuthGuard — it reads `req.user`.
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  private readonly logger = new Logger(SuperAdminGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const user = req.user;
    if (!user?.id || user.telegramId == null) {
      throw new UnauthorizedException('Authentication required');
    }

    const ids = parseSuperAdminIds(process.env.SUPER_ADMIN_TELEGRAM_IDS);
    if (ids.size === 0) {
      this.logger.warn('SUPER_ADMIN_TELEGRAM_IDS is empty — super-admin routes are locked down.');
      throw new ForbiddenException('Super-admin access is not configured');
    }

    let callerId: bigint;
    try {
      callerId = typeof user.telegramId === 'bigint' ? user.telegramId : BigInt(user.telegramId);
    } catch {
      throw new ForbiddenException('Invalid caller identity');
    }

    if (!ids.has(callerId)) {
      throw new ForbiddenException('Super-admin access required');
    }
    return true;
  }
}
