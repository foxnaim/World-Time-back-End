import { Injectable, Logger } from '@nestjs/common';
import { Context, MiddlewareFn } from 'telegraf';
import { PrismaService } from '@/common/prisma.service';

@Injectable()
export class UserMiddleware {
  private readonly logger = new Logger(UserMiddleware.name);

  constructor(private readonly prisma: PrismaService) {}

  use(): MiddlewareFn<Context> {
    return async (ctx, next) => {
      const from = ctx.from;
      if (!from) return next();

      const telegramId = BigInt(from.id);
      try {
        let user = await this.prisma.user.findUnique({
          where: { telegramId },
        });

        if (!user) {
          user = await this.prisma.user.create({
            data: {
              telegramId,
              firstName: from.first_name || from.username || 'Telegram user',
              lastName: from.last_name ?? null,
              username: from.username ?? null,
            },
          });
        }

        (ctx.state as any).user = user;
      } catch (err) {
        this.logger.error(
          `Failed to resolve user: ${(err as Error).message}`,
        );
      }

      return next();
    };
  }
}
