import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EmployeeRole, InviteToken, Prisma } from '@prisma/client';
import { nanoid } from 'nanoid';
import { PrismaService } from '@/common/prisma.service';

export interface InviteTokenPayload {
  companyId: string;
  role: EmployeeRole | 'OWNER' | 'MANAGER' | 'STAFF';
  position?: string | null;
  monthlySalary?: number | Prisma.Decimal | string | null;
  hourlyRate?: number | Prisma.Decimal | string | null;
  invitedByUserId: string;
}

export interface StoredInvite {
  token: string;
  companyId: string;
  role: EmployeeRole;
  position: string | null;
  monthlySalary: Prisma.Decimal | null;
  hourlyRate: Prisma.Decimal | null;
  invitedByUserId: string;
  consumedByUserId: string | null;
  consumedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
}

const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const CONSUMED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Persistent storage for Telegram deep-link invite tokens, backed by Prisma.
 *
 * Survives process restarts and is safe under horizontal scaling.
 */
@Injectable()
export class InviteTokenService {
  private readonly logger = new Logger(InviteTokenService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Issue a fresh invite token and persist its payload.
   *
   * @returns the generated token string and computed expiry.
   */
  async issue(payload: InviteTokenPayload): Promise<{ token: string; expiresAt: Date }> {
    const token = nanoid(16);
    const expiresAt = new Date(Date.now() + TTL_MS);

    await this.prisma.inviteToken.create({
      data: {
        token,
        companyId: payload.companyId,
        role: payload.role as EmployeeRole,
        position: payload.position ?? null,
        monthlySalary:
          payload.monthlySalary === undefined || payload.monthlySalary === null
            ? null
            : (payload.monthlySalary as Prisma.Decimal),
        hourlyRate:
          payload.hourlyRate === undefined || payload.hourlyRate === null
            ? null
            : (payload.hourlyRate as Prisma.Decimal),
        invitedByUserId: payload.invitedByUserId,
        expiresAt,
      },
    });

    return { token, expiresAt };
  }

  /**
   * Atomically consume an invite. Returns the payload if valid, or null if
   * the token is unknown, expired, or already consumed. Marks the row as
   * consumed by `consumedByUserId` at the current time.
   */
  async consume(token: string, consumedByUserId: string): Promise<StoredInvite | null> {
    const now = new Date();

    // Use updateMany with guard conditions so concurrent callers race safely:
    // only one wins and gets count === 1.
    const result = await this.prisma.inviteToken.updateMany({
      where: {
        token,
        consumedAt: null,
        expiresAt: { gt: now },
      },
      data: {
        consumedAt: now,
        consumedByUserId,
      },
    });

    if (result.count === 0) return null;

    const row = await this.prisma.inviteToken.findUnique({ where: { token } });
    if (!row) return null;
    return this.toStored(row);
  }

  /**
   * Peek at an invite without consuming it. Returns null if the token is
   * unknown, expired, or already consumed.
   */
  async peek(token: string): Promise<StoredInvite | null> {
    const row = await this.prisma.inviteToken.findUnique({ where: { token } });
    if (!row) return null;
    if (row.consumedAt) return null;
    if (row.expiresAt.getTime() < Date.now()) return null;
    return this.toStored(row);
  }

  /**
   * List invite tokens for a company (includes all lifecycle states; callers
   * can filter as needed).
   */
  async list(companyId: string): Promise<InviteToken[]> {
    return this.prisma.inviteToken.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Hourly cleanup: remove tokens that have expired while unused, and
   * consumed tokens older than 30 days (retention window for audit).
   */
  @Cron('0 * * * *')
  async cleanup(): Promise<void> {
    const now = new Date();
    const consumedCutoff = new Date(now.getTime() - CONSUMED_RETENTION_MS);

    const result = await this.prisma.inviteToken.deleteMany({
      where: {
        OR: [{ consumedAt: null, expiresAt: { lt: now } }, { consumedAt: { lt: consumedCutoff } }],
      },
    });

    if (result.count > 0) {
      this.logger.debug(`Cleaned up ${result.count} stale invite token(s)`);
    }
  }

  private toStored(row: InviteToken): StoredInvite {
    return {
      token: row.token,
      companyId: row.companyId,
      role: row.role,
      position: row.position,
      monthlySalary: row.monthlySalary,
      hourlyRate: row.hourlyRate,
      invitedByUserId: row.invitedByUserId,
      consumedByUserId: row.consumedByUserId,
      consumedAt: row.consumedAt,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
    };
  }
}
