import { UseFilters } from '@nestjs/common';
import { Action, Command, Ctx, Hears, Update } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { PrismaService } from '@/common/prisma.service';
import { TimeEntryService } from '../../time-entry/time-entry.service';
import { projectsInline, stopInline } from '../keyboards';
import { TelegramErrorsFilter } from './errors.filter';

function formatElapsed(startedAt: Date): string {
  const ms = Date.now() - startedAt.getTime();
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}ч ${m}м`;
}

@Update()
@UseFilters(TelegramErrorsFilter)
export class ProjectHandler {
  constructor(
    private readonly prisma: PrismaService,
    private readonly timeEntries: TimeEntryService,
  ) {}

  @Command('projects')
  async projectsCmd(@Ctx() ctx: Context): Promise<void> {
    await this.listProjects(ctx);
  }

  @Hears(/^(Проекты|Projects)$/i)
  async projectsHears(@Ctx() ctx: Context): Promise<void> {
    await this.listProjects(ctx);
  }

  private async listProjects(ctx: Context): Promise<void> {
    const user = (ctx.state as any).user;
    if (!user) {
      await ctx.reply('Сначала выполни /start.');
      return;
    }

    const projects = await this.prisma.project.findMany({
      where: {
        userId: user.id,
        status: { not: 'ARCHIVED' },
      },
      select: { id: true, name: true },
      take: 20,
      orderBy: { updatedAt: 'desc' },
    });

    if (!projects.length) {
      await ctx.reply('Проектов пока нет. Создай первый на сайте.');
      return;
    }

    await ctx.reply('Твои проекты:', projectsInline(projects));
  }

  @Action(/^start_(.+)$/)
  async startTimer(@Ctx() ctx: Context): Promise<void> {
    const user = (ctx.state as any).user;
    if (!user) {
      await ctx.answerCbQuery('Нужна авторизация.');
      return;
    }

    const match = (ctx as any).match as RegExpExecArray | undefined;
    const projectId = match?.[1];
    if (!projectId) {
      await ctx.answerCbQuery('Проект не найден.');
      return;
    }

    try {
      const entry = await this.timeEntries.start(user.id, projectId);
      await ctx.answerCbQuery('Таймер запущен.');
      await ctx.reply('Таймер запущен.', stopInline(entry.id));
    } catch (err) {
      await ctx.answerCbQuery((err as Error).message?.slice(0, 190) ?? 'Ошибка');
    }
  }

  @Action(/^stop_(.+)$/)
  async stopTimer(@Ctx() ctx: Context): Promise<void> {
    const user = (ctx.state as any).user;
    if (!user) {
      await ctx.answerCbQuery('Нужна авторизация.');
      return;
    }

    const match = (ctx as any).match as RegExpExecArray | undefined;
    const entryId = match?.[1];
    if (!entryId) {
      await ctx.answerCbQuery('Запись не найдена.');
      return;
    }

    try {
      const entry = await this.timeEntries.stop(user.id, entryId);
      const seconds = entry.durationSec ?? 0;
      const minutes = Math.floor(seconds / 60);
      await ctx.answerCbQuery('Остановлен.');
      await ctx.reply(
        `Таймер остановлен. Записано: ${Math.floor(minutes / 60)}ч ${minutes % 60}м.`,
      );
    } catch (err) {
      await ctx.answerCbQuery((err as Error).message?.slice(0, 190) ?? 'Ошибка');
    }
  }

  @Command('timer')
  async timerCmd(@Ctx() ctx: Context): Promise<void> {
    await this.showActive(ctx);
  }

  @Hears(/^(Таймер|Timer)$/i)
  async timerHears(@Ctx() ctx: Context): Promise<void> {
    await this.showActive(ctx);
  }

  private async showActive(ctx: Context): Promise<void> {
    const user = (ctx.state as any).user;
    if (!user) {
      await ctx.reply('Сначала выполни /start.');
      return;
    }

    const active = await this.prisma.timeEntry.findFirst({
      where: { project: { userId: user.id }, endedAt: null },
      include: { project: { select: { name: true } } },
      orderBy: { startedAt: 'desc' },
    });

    if (!active) {
      await ctx.reply('Активного таймера нет. /projects чтобы запустить.');
      return;
    }

    await ctx.reply(
      `Идёт: ${active.project?.name ?? 'Проект'} — ${formatElapsed(active.startedAt)}.`,
      stopInline(active.id),
    );
  }
}
