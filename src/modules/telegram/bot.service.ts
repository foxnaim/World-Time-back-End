import { Injectable, Logger } from '@nestjs/common';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf } from 'telegraf';
import type { ExtraReplyMessage } from 'telegraf/typings/telegram-types';

@Injectable()
export class BotService {
  private readonly logger = new Logger(BotService.name);

  constructor(@InjectBot() private readonly bot: Telegraf) {}

  async notifyUser(
    telegramId: bigint | string | number,
    text: string,
    options?: ExtraReplyMessage,
  ): Promise<boolean> {
    const chatId = typeof telegramId === 'bigint' ? Number(telegramId) : Number(telegramId);
    try {
      await this.bot.telegram.sendMessage(chatId, text, options);
      return true;
    } catch (err) {
      this.logger.warn(`notifyUser failed for chat ${chatId}: ${(err as Error).message}`);
      return false;
    }
  }
}
