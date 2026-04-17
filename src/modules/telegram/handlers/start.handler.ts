import { Logger, UseFilters } from '@nestjs/common';
import { Ctx, Start, Update } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { PrismaService } from '@/common/prisma.service';
import { CheckinService } from '../../checkin/checkin.service';
import { InviteTokenService } from '../../company/invite-token.service';
import { mainMenu } from '../keyboards';
import { getSession } from '../session';
import { TelegramErrorsFilter } from './errors.filter';

function resolveRole(user: any): 'b2b' | 'b2c' | 'both' {
  const hasCompany = Boolean(user?.companyId || user?.employee);
  const hasClientProfile = Boolean(user?.clientProfile || user?.isFreelancer);
  if (hasCompany && hasClientProfile) return 'both';
  if (hasCompany) return 'b2b';
  return 'b2c';
}

@Update()
@UseFilters(TelegramErrorsFilter)
export class StartHandler {
  private readonly logger = new Logger(StartHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly checkin: CheckinService,
    private readonly invites: InviteTokenService,
  ) {}

  @Start()
  async start(@Ctx() ctx: Context & { startPayload?: string }): Promise<void> {
    const user = (ctx.state as any).user;
    const payload = (ctx as any).startPayload as string | undefined;
    const role = resolveRole(user);

    if (!user) {
      await ctx.reply(
        'Не удалось инициализировать аккаунт. Попробуй /start ещё раз.',
      );
      return;
    }

    if (payload && payload.startsWith('qr_')) {
      const code = payload.slice(3);
      const session = getSession(user.telegramId);
      try {
        await this.checkin.scan(user.id, {
          token: code,
          latitude: session.lastLocation?.lat,
          longitude: session.lastLocation?.lng,
        });
        await ctx.reply('Отметка принята. Хорошего дня.', mainMenu(role));
      } catch (err) {
        const msg = (err as Error).message || 'Не удалось отметиться.';
        session.pendingQr = code;
        await ctx.reply(
          `Не удалось отметиться: ${msg}\nПришли геолокацию и попробуй ещё раз.`,
        );
      }
      return;
    }

    if (payload && payload.startsWith('inv_')) {
      const token = payload.slice(4);
      try {
        const claim = await this.invites.consume(token, user.id);
        if (!claim) {
          throw new Error('Приглашение недействительно или истекло.');
        }
        await this.prisma.employee.upsert({
          where: {
            userId_companyId: {
              userId: user.id,
              companyId: claim.companyId,
            },
          },
          create: {
            userId: user.id,
            companyId: claim.companyId,
            role: claim.role,
            position: claim.position ?? null,
            monthlySalary: claim.monthlySalary ?? undefined,
            hourlyRate: claim.hourlyRate ?? undefined,
          },
          update: {},
        });
        await ctx.reply(
          'Приглашение принято. Ты в команде.',
          mainMenu('b2b'),
        );
      } catch (err) {
        const msg = (err as Error).message || 'Приглашение недействительно.';
        await ctx.reply(`Не удалось принять приглашение: ${msg}`);
      }
      return;
    }

    await ctx.reply(
      'Привет. Это WorkTime — учёт рабочего времени.\n' +
        'Нажми «Войти», чтобы подключить аккаунт на сайте, ' +
        'или используй /auth.',
      mainMenu(role),
    );
  }
}
