import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import { TelegrafArgumentsHost } from 'nestjs-telegraf';
import { Context } from 'telegraf';

@Catch()
export class TelegramErrorsFilter implements ExceptionFilter {
  private readonly logger = new Logger(TelegramErrorsFilter.name);

  async catch(exception: unknown, host: ArgumentsHost): Promise<void> {
    const tgHost = TelegrafArgumentsHost.create(host);
    const ctx = tgHost.getContext<Context>();

    const msg = exception instanceof Error ? exception.message : String(exception);
    this.logger.error(
      `Handler error: ${msg}`,
      exception instanceof Error ? exception.stack : undefined,
    );

    try {
      await ctx.reply('Что-то пошло не так, попробуй позже.');
    } catch {
      // swallow secondary failures
    }
  }
}
