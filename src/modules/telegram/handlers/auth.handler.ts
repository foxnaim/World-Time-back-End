import { UseFilters } from '@nestjs/common';
import { Command, Ctx, Hears, Update } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { AuthService } from '../../auth/auth.service';
import { TelegramErrorsFilter } from './errors.filter';

@Update()
@UseFilters(TelegramErrorsFilter)
export class AuthHandler {
  constructor(private readonly auth: AuthService) {}

  @Command('auth')
  async authCmd(@Ctx() ctx: Context): Promise<void> {
    await this.sendOtc(ctx);
  }

  @Hears(/^(Войти|Login)$/i)
  async authHears(@Ctx() ctx: Context): Promise<void> {
    await this.sendOtc(ctx);
  }

  private async sendOtc(ctx: Context): Promise<void> {
    const user = (ctx.state as any).user;
    if (!user) {
      await ctx.reply('Сначала выполни /start.');
      return;
    }

    const code = this.auth.issueBotOneTimeCode(user.telegramId);
    await ctx.reply(`Введите этот код на сайте: ${code}\nКод действует 2 минуты.`);
  }
}
