import { Module, OnModuleInit, Optional, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TelegrafModule } from 'nestjs-telegraf';
import type { Context, MiddlewareFn } from 'telegraf';
import { PrismaModule } from '@/common/prisma.module';
import { PrismaService } from '@/common/prisma.service';
import { RedisService } from '@/common/redis/redis.service';
import { AuthModule } from '../auth/auth.module';
import { CompanyModule } from '../company/company.module';
import { CheckinModule } from '../checkin/checkin.module';
import { ProjectModule } from '../project/project.module';
import { TimeEntryModule } from '../time-entry/time-entry.module';
import { BotService } from './bot.service';
import { StartHandler } from './handlers/start.handler';
import { AuthHandler } from './handlers/auth.handler';
import { CheckinHandler } from './handlers/checkin.handler';
import { ProjectHandler } from './handlers/project.handler';
import { StatsHandler } from './handlers/stats.handler';
import { UserMiddleware } from './middleware/user.middleware';
import { TelegramErrorsFilter } from './handlers/errors.filter';
import { registerSessionRedis } from './session';

/**
 * Telegraf bot module.
 *
 * Key wiring note: the user-resolution middleware is registered INSIDE
 * forRootAsync.useFactory via `middlewares:` option. That way nestjs-telegraf
 * attaches it BEFORE `bot.launch()` runs. The previous approach of
 * `bot.use(...)` in onModuleInit registered the middleware AFTER launch,
 * so the first updates arrived without ctx.state.user populated.
 */
@Module({
  imports: [
    TelegrafModule.forRootAsync({
      imports: [ConfigModule, PrismaModule],
      inject: [ConfigService, PrismaService],
      useFactory: (config: ConfigService, prisma: PrismaService) => {
        const logger = new Logger('TelegrafUserMiddleware');
        const token = config.get<string>('TELEGRAM_BOT_TOKEN') ?? '';

        const userMiddleware: MiddlewareFn<Context> = async (ctx, next) => {
          const from = ctx.from;
          if (!from) return next();
          try {
            const telegramId = BigInt(from.id);
            let user = await prisma.user.findUnique({
              where: { telegramId },
              include: { employees: true },
            });
            if (!user) {
              user = await prisma.user.create({
                data: {
                  telegramId,
                  firstName: from.first_name || from.username || 'Telegram user',
                  lastName: from.last_name ?? null,
                  username: from.username ?? null,
                },
                include: { employees: true },
              });
            }
            (ctx.state as { user?: unknown }).user = user;
          } catch (err) {
            logger.error(
              `resolve user failed: ${(err as Error).message}`,
              (err as Error).stack,
            );
          }
          return next();
        };

        return {
          token,
          middlewares: [userMiddleware],
          // When token is missing, disable launch entirely so the app can
          // still boot (useful for tests / local dev without a bot).
          launchOptions: token ? {} : false,
        };
      },
    }),
    PrismaModule,
    AuthModule,
    CompanyModule,
    CheckinModule,
    ProjectModule,
    TimeEntryModule,
  ],
  providers: [
    BotService,
    UserMiddleware,
    StartHandler,
    AuthHandler,
    CheckinHandler,
    ProjectHandler,
    StatsHandler,
    TelegramErrorsFilter,
  ],
  exports: [BotService],
})
export class TelegramModule implements OnModuleInit {
  constructor(@Optional() private readonly redis?: RedisService) {}

  onModuleInit(): void {
    registerSessionRedis(this.redis ?? null);
  }
}
