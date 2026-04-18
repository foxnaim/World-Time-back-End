import { createHmac } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';

import { AuthService } from './auth.service';

/**
 * Unit tests for AuthService — no DB, no network.
 *
 * PrismaService is stubbed because none of the methods exercised here
 * (verifyTelegramInitData + OTC round-trip) read or write the database.
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

function makeConfig(overrides: Record<string, string | undefined> = {}): ConfigService {
  const values: Record<string, string | undefined> = {
    TELEGRAM_BOT_TOKEN: 'test-telegram-bot-token',
    JWT_ACCESS_SECRET: 'test-access-secret-value-for-jest',
    JWT_REFRESH_SECRET: 'test-refresh-secret-value-for-jest',
    ...overrides,
  };
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

/**
 * Build a Telegram-style initData string with a valid HMAC. When `tamperHash`
 * is provided it replaces the computed hash so the signature check fails.
 */
function buildInitData(
  botToken: string,
  user: { id: number; first_name: string; username?: string },
  authDateSec: number,
  tamperHash?: string,
): string {
  const params = new URLSearchParams();
  params.set('auth_date', String(authDateSec));
  params.set('query_id', 'AAH_unit_test_query_id');
  params.set('user', JSON.stringify(user));

  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = tamperHash ?? createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  params.set('hash', hash);
  return params.toString();
}

describe('AuthService (service-adjacent spec)', () => {
  const botToken = 'test-telegram-bot-token';
  const user = { id: 7001, first_name: 'Ada', username: 'ada_l' };

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
    it('accepts a valid HMAC and returns the parsed user', async () => {
      const now = Math.floor(Date.now() / 1000);
      const initData = buildInitData(botToken, user, now);

      const parsed = await service.verifyTelegramInitData(initData);
      expect(parsed.id).toBe(user.id);
      expect(parsed.first_name).toBe('Ada');
    });

    it('rejects a tampered HMAC', async () => {
      const now = Math.floor(Date.now() / 1000);
      const initData = buildInitData(botToken, user, now, 'deadbeef'.repeat(8));

      await expect(service.verifyTelegramInitData(initData)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects an expired auth_date (>5 minutes old)', async () => {
      const stale = Math.floor(Date.now() / 1000) - 10 * 60;
      const initData = buildInitData(botToken, user, stale);

      await expect(service.verifyTelegramInitData(initData)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe('OTC issue + consume round-trip', () => {
    it('consume returns the issued telegramId', () => {
      const tg = BigInt(12345);
      const code = service.issueBotOneTimeCode(tg);
      expect(code).toMatch(/^\d{6}$/);
      expect(service.consumeBotOneTimeCode(code)).toBe(tg);
    });

    it('consume is single-use: second call returns null', () => {
      const code = service.issueBotOneTimeCode(BigInt(1));
      expect(service.consumeBotOneTimeCode(code)).not.toBeNull();
      expect(service.consumeBotOneTimeCode(code)).toBeNull();
    });
  });
});
