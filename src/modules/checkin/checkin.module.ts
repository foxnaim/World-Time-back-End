import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import { CheckinController } from './checkin.controller';
import { CheckinService } from './checkin.service';
import { QrService } from './qr.service';
import { SseHub } from './sse.helper';

/**
 * CheckinModule
 *
 * - PrismaService is provided by the @Global() PrismaModule registered in
 *   AppModule, so it's injected without an explicit import here.
 * - ScheduleModule.forRoot() is also assumed to be wired up at the AppModule
 *   level; @Cron decorators on QrService are picked up globally.
 * - JwtModule is re-registered locally so the controller can verify an
 *   access token on Public SSE/display routes without going through Passport.
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_ACCESS_SECRET'),
      }),
    }),
  ],
  controllers: [CheckinController],
  providers: [CheckinService, QrService, SseHub],
  exports: [CheckinService, QrService],
})
export class CheckinModule {}
