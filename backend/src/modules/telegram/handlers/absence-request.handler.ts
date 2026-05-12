import { Logger, UseFilters } from '@nestjs/common';
import { Action, Command, Ctx, Hears, On, Update } from 'nestjs-telegraf';
import { Context, Markup } from 'telegraf';
import { Message } from 'telegraf/typings/core/types/typegram';
import { AbsenceStatus, AbsenceType, EmployeeRole } from '@prisma/client';
import { PrismaService } from '@/common/prisma.service';
import { BotService } from '../bot.service';
import { getSession } from '../session';
import { TelegramErrorsFilter } from './errors.filter';

const TYPE_LABELS: Record<AbsenceType, string> = {
  VACATION: 'отпуск',
  SICK_LEAVE: 'больничный',
  DAY_OFF: 'отгул',
  BUSINESS_TRIP: 'командировку',
};

const APPROVER_ROLES: EmployeeRole[] = [
  EmployeeRole.OWNER,
  EmployeeRole.MANAGER,
  EmployeeRole.HR,
];

function fmtDate(d: Date): string {
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Parse a date the user typed: `YYYY-MM-DD`, `сегодня`/`today`, or `+N`
 * (N days from today). Returns a YYYY-MM-DD string or null.
 */
function parseUserDate(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  if (s === 'сегодня' || s === 'today') return ymd(new Date());
  const plus = /^\+(\d+)$/.exec(s);
  if (plus) {
    const d = new Date();
    d.setDate(d.getDate() + Number(plus[1]));
    return ymd(d);
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) {
    const d = new Date(`${s}T00:00:00`);
    if (!Number.isNaN(d.getTime())) return ymd(d);
  }
  return null;
}

@Update()
@UseFilters(TelegramErrorsFilter)
export class AbsenceRequestHandler {
  private readonly logger = new Logger(AbsenceRequestHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bot: BotService,
  ) {}

  // ---------------------------------------------------------------------------
  // Flow entry
  // ---------------------------------------------------------------------------

  @Command('leave')
  async leaveCmd(@Ctx() ctx: Context): Promise<void> {
    await this.startFlow(ctx);
  }

  @Hears(/^(Запросить отпуск|Request leave)$/i)
  async leaveHears(@Ctx() ctx: Context): Promise<void> {
    await this.startFlow(ctx);
  }

  private async startFlow(ctx: Context): Promise<void> {
    const user = (ctx.state as any).user;
    if (!user) {
      await ctx.reply('Сначала выполни /start.');
      return;
    }

    const employees = await this.prisma.employee.findMany({
      where: { userId: user.id, status: 'ACTIVE' },
      include: { company: { select: { id: true, name: true } } },
    });
    if (employees.length === 0) {
      await ctx.reply('Ты не состоишь ни в одной компании.');
      return;
    }

    const session = getSession(user.telegramId);
    session.absenceFlow = { step: 'type' };

    if (employees.length === 1) {
      session.absenceFlow = {
        step: 'type',
        companyId: employees[0].companyId,
        employeeId: employees[0].id,
      };
      await this.askType(ctx);
      return;
    }

    // Multiple companies — ask which one first.
    session.absenceFlow = { step: 'company' };
    await ctx.reply(
      'В какой компании?',
      Markup.inlineKeyboard(
        employees.map((e) => [Markup.button.callback(e.company.name, `absco:${e.id}`)]),
      ),
    );
  }

  private async askType(ctx: Context): Promise<void> {
    await ctx.reply(
      'Какой тип отсутствия?',
      Markup.inlineKeyboard([
        [Markup.button.callback('Отпуск', 'abstype:VACATION')],
        [Markup.button.callback('Больничный', 'abstype:SICK_LEAVE')],
        [Markup.button.callback('Отгул', 'abstype:DAY_OFF')],
        [Markup.button.callback('Командировка', 'abstype:BUSINESS_TRIP')],
      ]),
    );
  }

  // ---------------------------------------------------------------------------
  // Step: pick company (multi-company users)
  // ---------------------------------------------------------------------------

  @Action(/^absco:(.+)$/)
  async pickCompany(@Ctx() ctx: Context): Promise<void> {
    const user = (ctx.state as any).user;
    if (!user) {
      await ctx.answerCbQuery('Нужна авторизация.');
      return;
    }
    const employeeId = ((ctx as any).match as RegExpExecArray | undefined)?.[1];
    if (!employeeId) {
      await ctx.answerCbQuery('Ошибка.');
      return;
    }
    const emp = await this.prisma.employee.findFirst({
      where: { id: employeeId, userId: user.id, status: 'ACTIVE' },
    });
    if (!emp) {
      await ctx.answerCbQuery('Компания не найдена.');
      return;
    }
    const session = getSession(user.telegramId);
    session.absenceFlow = { step: 'type', companyId: emp.companyId, employeeId: emp.id };
    await ctx.answerCbQuery();
    await this.askType(ctx);
  }

  // ---------------------------------------------------------------------------
  // Step: pick type
  // ---------------------------------------------------------------------------

  @Action(/^abstype:(VACATION|SICK_LEAVE|DAY_OFF|BUSINESS_TRIP)$/)
  async pickType(@Ctx() ctx: Context): Promise<void> {
    const user = (ctx.state as any).user;
    if (!user) {
      await ctx.answerCbQuery('Нужна авторизация.');
      return;
    }
    const type = ((ctx as any).match as RegExpExecArray | undefined)?.[1] as AbsenceType | undefined;
    const session = getSession(user.telegramId);
    const flow = session.absenceFlow;
    if (!flow || !flow.companyId || !flow.employeeId || !type) {
      await ctx.answerCbQuery('Начни заново: /leave');
      return;
    }
    session.absenceFlow = { ...flow, step: 'start', type };
    await ctx.answerCbQuery();
    await ctx.reply(
      'Дата начала? Формат: ГГГГ-ММ-ДД, либо «сегодня», либо «+N» (через N дней).',
    );
  }

  // ---------------------------------------------------------------------------
  // Step: dates (free text)
  // ---------------------------------------------------------------------------

  @On('text')
  async onText(@Ctx() ctx: Context): Promise<void> {
    const user = (ctx.state as any).user;
    if (!user) return;
    const session = getSession(user.telegramId);
    const flow = session.absenceFlow;
    if (!flow || (flow.step !== 'start' && flow.step !== 'end')) return; // not our turn

    const msg = ctx.message as Message.TextMessage | undefined;
    const text = msg?.text ?? '';
    if (text.startsWith('/')) return; // let command handlers deal with it

    const parsed = parseUserDate(text);
    if (!parsed) {
      await ctx.reply('Не понял дату. Формат: ГГГГ-ММ-ДД, «сегодня» или «+N».');
      return;
    }

    if (flow.step === 'start') {
      session.absenceFlow = { ...flow, step: 'end', startDate: parsed };
      await ctx.reply('Дата окончания? (тот же формат; для одного дня укажи ту же дату)');
      return;
    }

    // step === 'end'
    const startDate = flow.startDate!;
    let endDate = parsed;
    if (new Date(endDate) < new Date(startDate)) {
      // swap to be forgiving
      endDate = startDate;
    }
    await this.submit(ctx, user, flow.companyId!, flow.employeeId!, flow.type!, startDate, endDate);
    delete session.absenceFlow;
  }

  private async submit(
    ctx: Context,
    user: { id: string; firstName: string; lastName?: string | null },
    companyId: string,
    employeeId: string,
    type: AbsenceType,
    startDate: string,
    endDate: string,
  ): Promise<void> {
    // Re-verify membership.
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, companyId, userId: user.id, status: 'ACTIVE' },
    });
    if (!employee) {
      await ctx.reply('Не удалось найти твою запись сотрудника. Начни заново: /leave');
      return;
    }

    const absence = await this.prisma.absence.create({
      data: {
        employeeId,
        type,
        startDate: new Date(`${startDate}T00:00:00`),
        endDate: new Date(`${endDate}T00:00:00`),
        status: AbsenceStatus.PENDING,
      },
    });

    await ctx.reply('📨 Заявка отправлена на согласование');

    // Notify approvers (OWNER/MANAGER/HR of that company).
    const approvers = await this.prisma.employee.findMany({
      where: { companyId, status: 'ACTIVE', role: { in: APPROVER_ROLES } },
      include: { user: { select: { telegramId: true } } },
    });
    const name =
      [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.firstName;
    const text = `🌴 ${name} просит ${TYPE_LABELS[type]}: ${fmtDate(new Date(startDate))} – ${fmtDate(new Date(endDate))}`;
    const kb = Markup.inlineKeyboard([
      [
        Markup.button.callback('✅ Одобрить', `abs:approve:${absence.id}`),
        Markup.button.callback('❌ Отклонить', `abs:reject:${absence.id}`),
      ],
    ]);
    for (const a of approvers) {
      if (a.userId === user.id) continue; // don't ping yourself
      this.bot.notifyUser(a.user.telegramId, text, kb).catch((e) =>
        this.logger.warn(`absence approver notify failed: ${(e as Error).message}`),
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Approve / reject (manager action)
  // ---------------------------------------------------------------------------

  @Action(/^abs:(approve|reject):(.+)$/)
  async decide(@Ctx() ctx: Context): Promise<void> {
    const user = (ctx.state as any).user;
    if (!user) {
      await ctx.answerCbQuery('Нужна авторизация.');
      return;
    }
    const match = (ctx as any).match as RegExpExecArray | undefined;
    const action = match?.[1] as 'approve' | 'reject' | undefined;
    const absenceId = match?.[2];
    if (!action || !absenceId) {
      await ctx.answerCbQuery('Ошибка.');
      return;
    }

    const absence = await this.prisma.absence.findUnique({
      where: { id: absenceId },
      include: {
        employee: {
          include: {
            company: { select: { id: true } },
            user: { select: { telegramId: true, firstName: true } },
          },
        },
      },
    });
    if (!absence) {
      await ctx.answerCbQuery('Заявка не найдена.');
      return;
    }

    // Verify the acting user is an approver of that company.
    const actor = await this.prisma.employee.findFirst({
      where: {
        userId: user.id,
        companyId: absence.employee.company.id,
        status: 'ACTIVE',
        role: { in: APPROVER_ROLES },
      },
    });
    if (!actor) {
      await ctx.answerCbQuery('Нет прав на это действие.');
      return;
    }

    if (absence.status !== AbsenceStatus.PENDING) {
      await ctx.answerCbQuery('Заявка уже обработана.');
      try {
        await ctx.editMessageReplyMarkup(undefined);
      } catch {
        /* ignore */
      }
      return;
    }

    const newStatus = action === 'approve' ? AbsenceStatus.APPROVED : AbsenceStatus.REJECTED;
    await this.prisma.absence.update({
      where: { id: absenceId },
      data: { status: newStatus, approvedById: user.id },
    });

    const empName = absence.employee.user.firstName;
    const range = `${fmtDate(absence.startDate)} – ${fmtDate(absence.endDate)}`;
    const typeLabel = TYPE_LABELS[absence.type];

    await ctx.answerCbQuery(action === 'approve' ? 'Одобрено' : 'Отклонено');
    try {
      const decisionLine =
        action === 'approve'
          ? `✅ Одобрено: ${empName}, ${typeLabel}, ${range}`
          : `❌ Отклонено: ${empName}, ${typeLabel}, ${range}`;
      await ctx.editMessageText(decisionLine);
    } catch {
      /* message may be too old to edit */
    }

    const requesterMsg =
      action === 'approve'
        ? `✅ Твой отпуск согласован: ${typeLabel}, ${range}.`
        : `❌ Заявка отклонена: ${typeLabel}, ${range}.`;
    this.bot.notifyUser(absence.employee.user.telegramId, requesterMsg).catch((e) =>
      this.logger.warn(`absence requester notify failed: ${(e as Error).message}`),
    );
  }
}
