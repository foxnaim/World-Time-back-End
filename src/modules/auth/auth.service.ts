import {
  Injectable,
  Logger,
  Optional,
  UnauthorizedException,
  InternalServerErrorException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';

import { PrismaService } from '@/common/prisma.service';
import { RedisService } from '@/common/redis/redis.service';

export interface TelegramUserPayload {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  language_code?: string;
}

export interface AuthTokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

interface OtcEntry {
  telegramId: bigint;
  expiresAt: number;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  /**
   * Local mirror of OTCs, kept so `consumeBotOneTimeCode` can stay synchronous
   * (the controller and bot handler both call it sync, and the test suite
   * advances fake timers over the TTL). When `RedisService` is wired in we
   * also fan out to Redis on issue/consume so tokens survive a process
   * restart and are visible to other instances.
   */
  private readonly otcStore = new Map<string, OtcEntry>();
  private static readonly OTC_TTL_MS = 2 * 60 * 1000;
  private static readonly OTC_TTL_SEC = 120;
  private static readonly INIT_DATA_MAX_AGE_SEC = 300;
  private static readonly OTC_KEY_PREFIX = 'otc:';

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @Optional() private readonly redis?: RedisService,
  ) {}

  async verifyTelegramInitData(initData: string): Promise<TelegramUserPayload> {
    const botToken = this.config.get<string>('TELEGRAM_BOT_TOKEN');
    if (!botToken) {
      this.logger.error('TELEGRAM_BOT_TOKEN is not configured');
      throw new InternalServerErrorException('Telegram verification not configured');
    }

    if (!initData || typeof initData !== 'string') {
      throw new UnauthorizedException('Missing initData');
    }

    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) {
      throw new UnauthorizedException('Missing hash in initData');
    }
    params.delete('hash');

    const dataCheckString = Array.from(params.entries())
      .map(([k, v]) => [k, v] as const)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
    const computed = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    const a = Buffer.from(computed, 'hex');
    const b = Buffer.from(hash, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      this.logger.warn('telegram initData hash mismatch');
      throw new UnauthorizedException('Invalid initData signature');
    }

    const authDateRaw = params.get('auth_date');
    const authDate = authDateRaw ? Number.parseInt(authDateRaw, 10) : NaN;
    if (!Number.isFinite(authDate)) {
      throw new UnauthorizedException('Invalid auth_date');
    }
    const nowSec = Math.floor(Date.now() / 1000);
    if (nowSec - authDate > AuthService.INIT_DATA_MAX_AGE_SEC) {
      this.logger.warn(`telegram initData expired auth_date=${authDate}`);
      throw new UnauthorizedException('initData expired');
    }

    const userRaw = params.get('user');
    if (!userRaw) {
      throw new UnauthorizedException('Missing user in initData');
    }
    let userParsed: TelegramUserPayload;
    try {
      userParsed = JSON.parse(userRaw) as TelegramUserPayload;
    } catch {
      throw new UnauthorizedException('Malformed user payload');
    }
    if (!userParsed?.id || !userParsed?.first_name) {
      throw new UnauthorizedException('Incomplete user payload');
    }
    return userParsed;
  }

  issueBotOneTimeCode(telegramId: bigint): string {
    this.pruneOtc();
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    this.otcStore.set(code, {
      telegramId,
      expiresAt: Date.now() + AuthService.OTC_TTL_MS,
    });
    // Mirror to Redis (if available) so the OTC survives restarts and is
    // visible on other instances. Fire-and-forget: a slow Redis must never
    // block the bot handler that produced the code.
    const redis = this.redis;
    if (redis) {
      void redis
        .set(
          AuthService.OTC_KEY_PREFIX + code,
          telegramId.toString(),
          AuthService.OTC_TTL_SEC,
        )
        .catch((err) =>
          this.logger.warn(
            `redis set otc failed: ${(err as Error).message ?? err}`,
          ),
        );
    }
    this.logger.log(`issued OTC telegramId=${telegramId.toString()}`);
    return code;
  }

  consumeBotOneTimeCode(code: string): bigint | null {
    this.pruneOtc();
    const entry = this.otcStore.get(code);
    const redis = this.redis;
    if (entry) {
      this.otcStore.delete(code);
      if (redis) {
        void redis
          .del(AuthService.OTC_KEY_PREFIX + code)
          .catch(() => undefined);
      }
      if (entry.expiresAt < Date.now()) return null;
      return entry.telegramId;
    }
    // Not in local mirror (e.g. issued on a different instance). Best-effort
    // lookup in Redis, kicked off in the background; surface a synchronous
    // miss for now — the caller will reject as expected. The async path still
    // deletes the key so a later retry on the owning instance doesn't reuse
    // it.
    if (redis) {
      void redis
        .get(AuthService.OTC_KEY_PREFIX + code)
        .then(async (val) => {
          if (val) {
            await redis.del(AuthService.OTC_KEY_PREFIX + code).catch(() => 0);
          }
        })
        .catch(() => undefined);
    }
    return null;
  }

  private pruneOtc(): void {
    const now = Date.now();
    for (const [code, entry] of this.otcStore) {
      if (entry.expiresAt < now) this.otcStore.delete(code);
    }
  }

  async upsertUserFromTelegram(tg: TelegramUserPayload) {
    const telegramId = BigInt(tg.id);
    const user = await this.prisma.user.upsert({
      where: { telegramId },
      create: {
        telegramId,
        firstName: tg.first_name,
        lastName: tg.last_name ?? null,
        username: tg.username ?? null,
        avatarUrl: tg.photo_url ?? null,
      },
      update: {
        firstName: tg.first_name,
        lastName: tg.last_name ?? null,
        username: tg.username ?? null,
        avatarUrl: tg.photo_url ?? null,
      },
    });
    this.logger.log(`upserted user telegramId=${telegramId.toString()}`);
    return user;
  }

  async getUserById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async getUserByTelegramId(telegramId: bigint) {
    return this.prisma.user.findUnique({ where: { telegramId } });
  }

  async issueTokens(userId: string): Promise<AuthTokenPair> {
    const accessSecret = this.config.get<string>('JWT_ACCESS_SECRET');
    const refreshSecret = this.config.get<string>('JWT_REFRESH_SECRET');
    if (!accessSecret || !refreshSecret) {
      throw new InternalServerErrorException('JWT secrets not configured');
    }
    const accessToken = await this.jwt.signAsync(
      { sub: userId },
      { secret: accessSecret, expiresIn: '15m' },
    );
    const refreshToken = await this.jwt.signAsync(
      { sub: userId, typ: 'refresh' },
      { secret: refreshSecret, expiresIn: '7d' },
    );
    return { accessToken, refreshToken, expiresIn: 15 * 60 };
  }

  async refresh(refreshToken: string): Promise<AuthTokenPair> {
    const refreshSecret = this.config.get<string>('JWT_REFRESH_SECRET');
    if (!refreshSecret) {
      throw new InternalServerErrorException('JWT refresh secret not configured');
    }
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; typ?: string }>(
        refreshToken,
        { secret: refreshSecret },
      );
      if (payload.typ !== 'refresh' || !payload.sub) {
        throw new UnauthorizedException('Invalid refresh token');
      }
      const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user) {
        throw new UnauthorizedException('User not found');
      }
      this.logger.log(`refresh success userId=${user.id}`);
      return this.issueTokens(user.id);
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      this.logger.warn('refresh token verification failed');
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }
}
