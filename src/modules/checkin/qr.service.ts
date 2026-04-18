import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { nanoid } from 'nanoid';
import { startOfDay } from 'date-fns';

import { PrismaService } from '@/common/prisma.service';
import type { QRTokenDisplay } from '@tact/types';
import { SseHub } from './sse.helper';

/** Rotation cadence, in seconds. Drives both the cron and the live SSE stream. */
export const ROTATION_SEC = 30;
/**
 * Token lifetime, in seconds. Intentionally larger than ROTATION_SEC so a QR
 * scanned in the last moments of its life still succeeds after the screen has
 * already advanced to the next token (5s overlap buffer).
 */
export const TTL_SEC = 45;

interface TokenPayload {
  /** companyId */
  c: string;
  /** rotation index (unix minute * 2 + half-minute bucket) */
  r: number;
  /** per-token nonce */
  n: string;
}

/**
 * Encodes and decodes the opaque QR payload. The format is:
 *
 *     base64url(JSON.stringify({ c, r, n })) + "." + base64url(hmac_sha256)
 *
 * An HMAC is required so that a client cannot forge a valid-looking token
 * without knowing the server secret, and cannot probe the database by
 * submitting arbitrary strings. The DB row is still the source of truth for
 * expiry and single-use-per-employee enforcement.
 */
function base64urlEncode(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64urlDecode(input: string): Buffer {
  const padded = input + '='.repeat((4 - (input.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function currentRotationIndex(nowMs = Date.now()): number {
  return Math.floor(nowMs / (ROTATION_SEC * 1000));
}

@Injectable()
export class QrService implements OnModuleInit {
  private readonly logger = new Logger(QrService.name);
  private hmacSecret!: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly sse: SseHub,
  ) {}

  onModuleInit(): void {
    const secret = this.config.get<string>('QR_HMAC_SECRET');
    if (!secret || secret.length < 16) {
      throw new Error(
        'QR_HMAC_SECRET must be configured (>=16 chars) for QR token signing',
      );
    }
    this.hmacSecret = secret;
  }

  // ---------------------------------------------------------------------------
  // Token encoding
  // ---------------------------------------------------------------------------

  private sign(payloadB64: string): string {
    return base64urlEncode(
      createHmac('sha256', this.hmacSecret).update(payloadB64).digest(),
    );
  }

  private encodeToken(payload: TokenPayload): string {
    const payloadB64 = base64urlEncode(JSON.stringify(payload));
    return `${payloadB64}.${this.sign(payloadB64)}`;
  }

  private decodeToken(token: string): TokenPayload {
    const dot = token.indexOf('.');
    if (dot < 1 || dot === token.length - 1) {
      throw new BadRequestException('Malformed QR token');
    }
    const payloadB64 = token.slice(0, dot);
    const sigB64 = token.slice(dot + 1);

    const expected = this.sign(payloadB64);
    // timingSafeEqual requires equal-length buffers; guard first.
    const a = Buffer.from(sigB64);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Invalid QR token signature');
    }

    let payload: TokenPayload;
    try {
      payload = JSON.parse(base64urlDecode(payloadB64).toString('utf8'));
    } catch {
      throw new BadRequestException('Unreadable QR token payload');
    }
    if (
      !payload ||
      typeof payload.c !== 'string' ||
      typeof payload.r !== 'number' ||
      typeof payload.n !== 'string'
    ) {
      throw new BadRequestException('Invalid QR token structure');
    }
    return payload;
  }

  // ---------------------------------------------------------------------------
  // Token lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Mint a brand-new token for the given company, persist it, and emit to
   * SSE subscribers. Called by the cron rotator and lazily by currentForCompany.
   */
  async generateForCompany(companyId: string): Promise<QRTokenDisplay> {
    const now = new Date();
    const payload: TokenPayload = {
      c: companyId,
      r: currentRotationIndex(now.getTime()),
      n: nanoid(8),
    };
    const token = this.encodeToken(payload);
    const expiresAt = new Date(now.getTime() + TTL_SEC * 1000);

    await this.prisma.qRToken.create({
      data: { token, companyId, expiresAt },
    });

    const display: QRTokenDisplay = {
      token,
      expiresAt: expiresAt.toISOString(),
      rotationInSec: ROTATION_SEC,
    };
    this.sse.publish(companyId, display);
    return display;
  }

  /**
   * Return the freshest still-valid token for a company, or mint one on the
   * fly if there isn't any (e.g. very first request, or after a long idle gap).
   */
  async currentForCompany(companyId: string): Promise<QRTokenDisplay> {
    const now = new Date();
    const existing = await this.prisma.qRToken.findFirst({
      where: { companyId, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      return {
        token: existing.token,
        expiresAt: existing.expiresAt.toISOString(),
        rotationInSec: ROTATION_SEC,
      };
    }
    return this.generateForCompany(companyId);
  }

  /**
   * Validate the signed token and confirm a row exists that hasn't expired.
   * `employeeId` is optional on this check — it's used to enforce
   * "same employee cannot reuse the same token twice" while still allowing
   * many employees to scan the same on-screen QR during its overlap window.
   */
  async verify(
    token: string,
    employeeId?: string,
  ): Promise<{ companyId: string; tokenId: string }> {
    const payload = this.decodeToken(token);

    const row = await this.prisma.qRToken.findUnique({
      where: { token },
    });
    if (!row) {
      throw new UnauthorizedException('Unknown QR token');
    }
    if (row.companyId !== payload.c) {
      // Defensive: the signed payload and the DB row disagree. Treat as forgery.
      throw new UnauthorizedException('QR token mismatch');
    }
    if (row.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('QR token expired');
    }
    if (employeeId && row.usedByEmployeeId === employeeId) {
      throw new ForbiddenException(
        'This QR has already been used for your check-in; wait for the next rotation',
      );
    }

    return { companyId: row.companyId, tokenId: row.id };
  }

  /**
   * Mark the token row with the first employee that successfully scanned it.
   * This is a best-effort single-use-per-employee record. A concurrent scan
   * from a different employee in the same TTL window is still accepted (the
   * DB just keeps the first writer's employeeId — the CheckIn rows carry the
   * real per-employee trail via `tokenId`).
   */
  async consume(token: string, employeeId: string): Promise<void> {
    await this.prisma.qRToken.updateMany({
      where: { token, usedByEmployeeId: null },
      data: { usedByEmployeeId: employeeId, usedAt: new Date() },
    });
  }

  // ---------------------------------------------------------------------------
  // Cron rotation
  // ---------------------------------------------------------------------------

  /**
   * Every 30 seconds, pre-mint the next token for every company that has at
   * least one active employee who has already checked in today — a cheap
   * proxy for "this office is in active use". This keeps the SSE stream
   * emitting fresh payloads even if no one has requested /qr/current lately.
   */
  @Cron('*/30 * * * * *')
  async rotateAll(): Promise<void> {
    try {
      const today = startOfDay(new Date());
      const activeCompanies = await this.prisma.company.findMany({
        where: {
          employees: {
            some: {
              status: 'ACTIVE',
              checkIns: { some: { timestamp: { gte: today } } },
            },
          },
        },
        select: { id: true },
      });

      if (activeCompanies.length === 0) return;

      await Promise.all(
        activeCompanies.map((c) =>
          this.generateForCompany(c.id).catch((err) => {
            this.logger.error(
              `Rotation failed for company=${c.id}: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }),
        ),
      );
      this.logger.debug(
        `Rotated QR for ${activeCompanies.length} active company(ies)`,
      );
    } catch (err) {
      this.logger.error(
        `rotateAll crashed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
