import { Module, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TelegrafModule } from 'nestjs-telegraf';
import { PrismaModule } from '@/common/prisma.module';
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

@Module({
  imports: [
    TelegrafModule.forRootAsync({
      imports: [ConfigModule, PrismaModule],
      inject: [ConfigService, UserMiddleware],
      useFactory: (config: ConfigService, userMiddleware: UserMiddleware) => ({
        token: config.get<string>('TELEGRAM_BOT_TOKEN') ?? '',
        middlewares: [userMiddleware.use()],
      }),
      extraProviders: [UserMiddleware],
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
