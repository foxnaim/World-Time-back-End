import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';

import { QrService } from './qr.service';

/**
 * Unit tests for QrService token HMAC round-trip.
 *
 * We stub PrismaService and SseHub so we don't touch the DB or emit real SSE
 * events. Only the crypto + persistence shape is under test here.
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

  it('generateForCompany round-trips through verify', async () => {
    const display = await service.generateForCompany('company-abc');
    expect(display.token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

    const verified = await service.verify(display.token);
    expect(verified.companyId).toBe('company-abc');
    expect(verified.tokenId).toMatch(/^tok-/);
  });

  it('rejects a tampered token signature', async () => {
    const display = await service.generateForCompany('company-xyz');
    const [payload] = display.token.split('.');
    const tampered = `${payload}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;

    await expect(service.verify(tampered)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token whose payload has been swapped out', async () => {
    const display = await service.generateForCompany('company-a');
    const [, sig] = display.token.split('.');
    // Forge a new payload with the old signature — signature won't match.
    const fakePayload = Buffer.from(JSON.stringify({ c: 'other-company', r: 1, n: 'x' }))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
    await expect(service.verify(`${fakePayload}.${sig}`)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('refuses to initialize when the HMAC secret is missing or too short', () => {
    const svc = new QrService(prisma as any, makeConfig('short'), sse);
    expect(() => svc.onModuleInit()).toThrow(/QR_HMAC_SECRET/);
  });
});
