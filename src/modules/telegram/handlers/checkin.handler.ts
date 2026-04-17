import { UseFilters } from '@nestjs/common';
import { Command, Ctx, Hears, On, Update } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { Message } from 'telegraf/typings/core/types/typegram';
import { CheckinService } from '../../checkin/checkin.service';
import { shareLocation } from '../keyboards';
import { getSession } from '../session';
import { TelegramErrorsFilter } from './errors.filter';

@Update()
@UseFilters(TelegramErrorsFilter)
export class CheckinHandler {
  constructor(private readonly checkin: CheckinService) {}

  @Command('checkin')
  async checkinCmd(@Ctx() ctx: Context): Promise<void> {
    await this.prompt(ctx);
  }

  @Hears(/^(Отметиться|Check\s?in)$/i)
  async checkinHears(@Ctx() ctx: Context): Promise<void> {
    await this.prompt(ctx);
  }

  private async prompt(ctx: Context): Promise<void> {
    const user = (ctx.state as any).user;
    if (!user) {
      await ctx.reply('Сначала выполни /start.');
      return;
    }
    await ctx.reply(
      'Отсканируй QR на входе. По желанию — отправь геолокацию, ' +
        'чтобы мы приняли отметку быстрее.',
      shareLocation(),
    );
  }

  @On('location')
  async onLocation(@Ctx() ctx: Context): Promise<void> {
    const user = (ctx.state as any).user;
    if (!user) return;

    const message = ctx.message as Message.LocationMessage | undefined;
    const location = message?.location;
    if (!location) return;

    const session = getSession(user.telegramId);
    session.lastLocation = {
      lat: location.latitude,
      lng: location.longitude,
      at: Date.now(),
    };

    if (session.pendingQr) {
      const code = session.pendingQr;
      session.pendingQr = undefined;
      try {
        await this.checkin.scan(user.id, {
          token: code,
          latitude: location.latitude,
          longitude: location.longitude,
        });
        await ctx.reply('Отметка принята.');
        return;
      } catch (err) {
        await ctx.reply(
          `Не удалось отметиться: ${(err as Error).message || 'ошибка.'}`,
        );
        return;
      }
    }

    await ctx.reply('Геолокация сохранена. Теперь отсканируй QR.');
  }
}
