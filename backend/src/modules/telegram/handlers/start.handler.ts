import { Logger, UseFilters } from '@nestjs/common';
import { Ctx, Start, Update } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { PrismaService } from '@/common/prisma.service';
import { CheckinService } from '../../checkin/checkin.service';
import { InviteTokenService } from '../../company/invite-token.service';
import { checkinMenu, mainMenu } from '../keyboards';
import { getSession, type TelegramSession } from '../session';
import { TelegramErrorsFilter } from './errors.filter';

/**
 * How long a location shared in the chat may stand in for the scanner's
 * position. A session lives 24 h, so without a limit one location shared at
 * the office would pass the geofence for every later scan, from anywhere.
 * Two minutes covers "send location, then scan the QR at the door"; an older
 * location is dropped and the bot asks for a new one.
 */
export const LOCATION_MAX_AGE_MS = 120_000;

/** The session's last location if it was shared within LOCATION_MAX_AGE_MS. */
function freshLocation(session: TelegramSession): TelegramSession['lastLocation'] {
  const location = session.lastLocation;
  if (!location) return undefined;
  const age = Date.now() - location.at;
  return age >= 0 && age <= LOCATION_MAX_AGE_MS ? location : undefined;
}

function resolveRole(user: any): 'owner' | 'b2b' | 'b2c' | 'both' {
  const employees: Array<{ role: string; status: string }> = user?.employees ?? [];
  const activeEmployees = employees.filter((e) => e.status === 'ACTIVE');

  const isOwner = activeEmployees.some((e) => e.role === 'OWNER');
  const isManager = activeEmployees.some((e) => e.role === 'MANAGER');
  const isStaffOnly =
    activeEmployees.length > 0 &&
    activeEmployees.every((e) => e.role === 'STAFF');

  // Owner: web login only, NEVER check-in (it's their company).
  // Even if they also have freelance projects — manage those via web.
  if (isOwner) return 'owner';
  // Manager: web access + can check in
  if (isManager) return 'both';
  // STAFF employee → b2b (no Войти — employees check in, don't need web login)
  if (isStaffOnly) return 'b2b';
  // Pure freelancer or new user
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

    this.logger.log(
      `/start received: telegramId=${ctx.from?.id}, userResolved=${Boolean(user)}, payload=${payload ?? '(none)'}`,
    );

    if (!user) {
      this.logger.warn(
        `/start without resolved user; telegramId=${ctx.from?.id}. Check UserMiddleware + Prisma.`,
      );
      await ctx.reply('Не удалось инициализировать аккаунт. Попробуй /start ещё раз.');
      return;
    }

    if (payload && payload.startsWith('qr_')) {
      const code = payload.slice(3);
      const session = getSession(user.telegramId);
      // A stale location counts as none: scan() refuses it where the office
      // has a geofence, and the catch below asks for a fresh one.
      const location = freshLocation(session);
      try {
        const result = await this.checkin.scan(user.id, {
          token: code,
          latitude: location?.lat,
          longitude: location?.lng,
        });
        if (result.type === 'IN') {
          await ctx.reply(
            '✅ Приход зафиксирован. Хорошего рабочего дня!\nНе забудьте отметиться при уходе.',
            checkinMenu(true),
          );
        } else {
          await ctx.reply('👋 Уход зафиксирован. Хорошего вечера!', checkinMenu(false));
        }
      } catch (err) {
        const msg = (err as Error).message || 'Не удалось отметиться.';
        session.pendingQr = code;
        await ctx.reply(`Не удалось отметиться: ${msg}\nПришли геолокацию и попробуй ещё раз.`);
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
        const freshUser = await this.prisma.user.findUnique({
          where: { id: user.id },
          include: {
            employees: { select: { role: true, status: true } },
            projects: { select: { id: true } },
          },
        });
        await ctx.reply('Приглашение принято. Ты в команде.', mainMenu(resolveRole(freshUser)));
      } catch (err) {
        const msg = (err as Error).message || 'Приглашение недействительно.';
        await ctx.reply(`Не удалось принять приглашение: ${msg}`);
      }
      return;
    }

    try {
      // For B2B employees (STAFF), show context-aware check-in keyboard
      // so "Уйти с работы" appears automatically when they're already in.
      if (role === 'b2b' || role === 'both') {
        const employees = (user?.employees ?? []) as Array<{ id: string; role: string; status: string }>;
        const activeEmployee = employees.find((e) => e.status === 'ACTIVE' && (e.role === 'STAFF' || e.role === 'MANAGER'));
        if (activeEmployee) {
          const isIn = await this.checkin.isEmployeeCurrentlyIn(activeEmployee.id);
          await ctx.reply(
            'Привет! Это Work Tact — ритм рабочего дня.',
            checkinMenu(isIn),
          );
          this.logger.log(`/start: sent checkinMenu(isIn=${isIn}) to telegramId=${ctx.from?.id}`);
          return;
        }
      }
      await ctx.reply(
        'Привет! Это Work Tact — ритм рабочего дня.\n' +
          'Нажми «Войти», чтобы подключить аккаунт на сайте, ' +
          'или используй /auth.',
        mainMenu(role),
      );
      this.logger.log(`/start: welcome sent to telegramId=${ctx.from?.id}`);
    } catch (err) {
      this.logger.error(`/start reply failed: ${(err as Error).message}`, (err as Error).stack);
      throw err;
    }
  }
}
