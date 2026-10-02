import { ConfigService } from '@nestjs/config';
import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';

import { QrService, TTL_SEC } from './qr.service';

/**
 * Unit tests for QrService tokens. A token is a random nanoid stored in the
 * QRToken table; the DB row is the authority for company, expiry and reuse.
 *
 * We stub PrismaService and SseHub so we don't touch the DB or emit real SSE
 * events.
 */

function makeConfig(secret = 'test-qr-hmac-secret-16chars-minimum'): ConfigService {
  return {
    get: jest.fn((key: string) => (key === 'QR_HMAC_SECRET' ? secret : undefined)),
  } as unknown as ConfigService;
}

function makePrisma() {
  const rows: any[] = [];
  return {
    rows,
    qRToken: {
      create: jest.fn(async ({ data }: any) => {
        const row = {
          id: `tok-${rows.length + 1}`,
          usedByEmployeeId: null,
          usedAt: null,
          createdAt: new Date(),
          ...data,
        };
        rows.push(row);
        return row;
      }),
      findUnique: jest.fn(
        async ({ where }: any) => rows.find((r) => r.token === where.token) ?? null,
      ),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
  };
}

const sse = { publish: jest.fn() } as any;

describe('QrService', () => {
  let service: QrService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(() => {
    prisma = makePrisma();
    service = new QrService(prisma as any, makeConfig(), sse);
    service.onModuleInit();
  });

  it('generateForCompany stores a short URL-safe token and round-trips through verify', async () => {
    const before = Date.now();
    const display = await service.generateForCompany('company-abc');

    // Telegram's /start payload allows only [A-Za-z0-9_-] and 64 chars.
    expect(display.token).toMatch(/^[A-Za-z0-9_-]{21}$/);
    expect(`qr_${display.token}`.length).toBeLessThanOrEqual(64);
    const row = prisma.rows[0];
    expect(row.token).toBe(display.token);
    expect(row.companyId).toBe('company-abc');
    expect(row.expiresAt.getTime() - before).toBeGreaterThanOrEqual(TTL_SEC * 1000);
    expect(sse.publish).toHaveBeenCalledWith('company-abc', display);

    const verified = await service.verify(display.token);
    expect(verified.companyId).toBe('company-abc');
    expect(verified.tokenId).toBe(row.id);
  });

  it('rejects a malformed token before any DB lookup', async () => {
    await expect(service.verify('payload.signature')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.qRToken.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a well-formed token that is not in the DB', async () => {
    await expect(service.verify('AAAAAAAAAAAAAAAAAAAAA')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects an expired token', async () => {
    const display = await service.generateForCompany('company-abc');
    prisma.rows[0].expiresAt = new Date(Date.now() - 1);
    await expect(service.verify(display.token)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses a second scan by the same employee, not by a colleague', async () => {
    const display = await service.generateForCompany('company-abc');
    prisma.rows[0].usedByEmployeeId = 'emp-1';
    await expect(service.verify(display.token, 'emp-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.verify(display.token, 'emp-2')).resolves.toMatchObject({
      companyId: 'company-abc',
    });
  });

  it('refuses to initialize when the HMAC secret is missing or too short', () => {
    const svc = new QrService(prisma as any, makeConfig('short'), sse);
    expect(() => svc.onModuleInit()).toThrow(/QR_HMAC_SECRET/);
  });
});
