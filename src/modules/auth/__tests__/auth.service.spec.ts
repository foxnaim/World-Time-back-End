import { createHmac } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InternalServerErrorException, UnauthorizedException } from '@nestjs/common';

import { AuthService } from '../auth.service';

/**
 * Unit tests for AuthService.
 *
 * These tests do not touch the database — PrismaService is a stub, since none
 * of the methods under test (verifyTelegramInitData, issueBotOneTimeCode,
 * consumeBotOneTimeCode) hit it.
 */

type PrismaStub = { user: Record<string, jest.Mock> };

function makePrismaStub(): PrismaStub {
  return {
    user: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  };
}

function makeConfig(overrides: Record<string, string> = {}): ConfigService {
  const values: Record<string, string> = {
    TELEGRAM_BOT_TOKEN: 'test-bot-token',
    JWT_ACCESS_SECRET: 'test-access-secret-value-for-jest',
    JWT_REFRESH_SECRET: 'test-refresh-secret-value-for-jest',
    ...overrides,
  };
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

/**
 * Build a Telegram-style initData URLSearchParams string with a valid HMAC
 * computed off the synthetic secret.
 *
 *   secretKey = HMAC_SHA256("WebAppData", botToken)
 *   hash      = HMAC_SHA256(secretKey, data_check_string).hex
 */
function buildInitData(
  botToken: string,
  user: { id: number; first_name: string; last_name?: string; username?: string },
  authDateSec: number,
  tamperHash?: string,
): string {
  const params = new URLSearchParams();
  params.set('auth_date', String(authDateSec));
  params.set('query_id', 'AAH_test_query_id');
  params.set('user', JSON.stringify(user));

  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash =
    tamperHash ??
    createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  params.set('hash', hash);
  return params.toString();
}

describe('AuthService', () => {
  let prisma: PrismaStub;
  let jwt: JwtService;
  let config: ConfigService;
  let service: AuthService;

  beforeEach(() => {
    prisma = makePrismaStub();
    jwt = { signAsync: jest.fn(), verifyAsync: jest.fn() } as unknown as JwtService;
    config = makeConfig();
    service = new AuthService(prisma as any, jwt, config);
  });

  describe('verifyTelegramInitData', () => {
    const botToken = 'test-bot-token';
    const user = { id: 4242, first_name: 'Ada', username: 'ada_l' };

    it('rejects a tampered hash', async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const initData = buildInitData(botToken, user, nowSec, 'deadbeef'.repeat(8));

      await expect(service.verifyTelegramInitData(initData)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('accepts a valid hash and returns the parsed user', async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const initData = buildInitData(botToken, user, nowSec);

      const parsed = await service.verifyTelegramInitData(initData);
      expect(parsed.id).toBe(user.id);
      expect(parsed.first_name).toBe('Ada');
      expect(parsed.username).toBe('ada_l');
    });

    it('rejects a stale auth_date (older than 5 minutes)', async () => {
      const staleSec = Math.floor(Date.now() / 1000) - 10 * 60;
      const initData = buildInitData(botToken, user, staleSec);

      await expect(service.verifyTelegramInitData(initData)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('throws InternalServerErrorException when bot token is not configured', async () => {
      const brokenConfig = {
        get: jest.fn((key: string) =>
          key === 'TELEGRAM_BOT_TOKEN' ? undefined : 'x',
        ),
      } as unknown as ConfigService;
      const brokenService = new AuthService(prisma as any, jwt, brokenConfig);

      await expect(
        brokenService.verifyTelegramInitData('anything'),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    });

    it('rejects empty initData', async () => {
      await expect(service.verifyTelegramInitData('')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects initData missing a hash param', async () => {
      await expect(
        service.verifyTelegramInitData('auth_date=123&user=%7B%7D'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('issueBotOneTimeCode / consumeBotOneTimeCode', () => {
    it('issues a 6-digit code', () => {
      const code = service.issueBotOneTimeCode(BigInt(12345));
      expect(code).toMatch(/^\d{6}$/);
    });

    it('consume returns the telegramId for a fresh code', () => {
      const tg = BigInt(999);
      const code = service.issueBotOneTimeCode(tg);
      expect(service.consumeBotOneTimeCode(code)).toBe(tg);
    });

    it('consume returns null for an unknown code', () => {
      expect(service.consumeBotOneTimeCode('000000')).toBeNull();
    });

    it('consume is single-use (second call returns null)', () => {
      const code = service.issueBotOneTimeCode(BigInt(1));
      expect(service.consumeBotOneTimeCode(code)).not.toBeNull();
      expect(service.consumeBotOneTimeCode(code)).toBeNull();
    });

    it('consume returns null after the 2-minute TTL has elapsed', () => {
      jest.useFakeTimers();
      try {
        const code = service.issueBotOneTimeCode(BigInt(42));
        // Advance past the 2-minute TTL.
        jest.advanceTimersByTime(2 * 60 * 1000 + 1);
        expect(service.consumeBotOneTimeCode(code)).toBeNull();
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
