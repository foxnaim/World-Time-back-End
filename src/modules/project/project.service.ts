import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@tact/database';
import type { ProjectMonthlySummary } from '@tact/types';
import { endOfMonth, parse, startOfMonth } from 'date-fns';

import { PrismaService } from '@/common/prisma.service';

import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

/**
 * ProjectService
 *
 * B2C freelancer-side project management. All reads/writes are scoped to the
 * authenticated user — ownership is enforced by `userId` on every query.
 *
 * The "real hourly rate" insight (see {@link monthlySummary}) is the product's
 * headline feature: compare declared vs actual ₽/час to surface underpriced
 * projects at month end.
 */
@Injectable()
export class ProjectService {
  private readonly logger = new Logger(ProjectService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateProjectDto) {
    const project = await this.prisma.project.create({
      data: {
        userId,
        name: dto.name,
        description: dto.description ?? null,
        hourlyRate: dto.hourlyRate !== undefined ? new Prisma.Decimal(dto.hourlyRate) : null,
        fixedPrice: dto.fixedPrice !== undefined ? new Prisma.Decimal(dto.fixedPrice) : null,
        currency: dto.currency ?? 'RUB',
      },
    });
    this.logger.log(`project.create id=${project.id} userId=${userId}`);
    return this.serialize(project);
  }

  /**
   * List projects for the user with aggregate totalSeconds + entryCount for
   * each. Uses a single groupBy + findMany so we don't N+1.
   */
  async list(userId: string) {
    const projects = await this.prisma.project.findMany({
      where: { userId },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });
    if (projects.length === 0) return [];

    const agg = await this.prisma.timeEntry.groupBy({
      by: ['projectId'],
      where: { projectId: { in: projects.map((p) => p.id) } },
      _sum: { durationSec: true },
      _count: { _all: true },
    });
    const byId = new Map(
      agg.map((a) => [
        a.projectId,
        {
          totalSeconds: a._sum.durationSec ?? 0,
          entryCount: a._count._all,
        },
      ]),
    );
    return projects.map((p) => ({
      ...this.serialize(p),
      totalSeconds: byId.get(p.id)?.totalSeconds ?? 0,
      entryCount: byId.get(p.id)?.entryCount ?? 0,
    }));
  }

  async findOne(userId: string, id: string) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: {
        entries: {
          orderBy: { startedAt: 'desc' },
          take: 20,
        },
      },
    });
    if (!project) throw new NotFoundException('Project not found');
    if (project.userId !== userId) {
      throw new ForbiddenException('Not your project');
    }

    const totalAgg = await this.prisma.timeEntry.aggregate({
      where: { projectId: id },
      _sum: { durationSec: true },
      _count: { _all: true },
    });

    return {
      ...this.serialize(project),
      totalSeconds: totalAgg._sum.durationSec ?? 0,
      entryCount: totalAgg._count._all,
      entries: project.entries.map((e) => ({
        id: e.id,
        projectId: e.projectId,
        startedAt: e.startedAt.toISOString(),
        endedAt: e.endedAt?.toISOString() ?? null,
        durationSec: e.durationSec ?? null,
        note: e.note ?? null,
        createdAt: e.createdAt.toISOString(),
      })),
    };
  }

  async update(userId: string, id: string, dto: UpdateProjectDto) {
    await this.assertOwnership(userId, id);

    const data: Prisma.ProjectUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.hourlyRate !== undefined) {
      data.hourlyRate = new Prisma.Decimal(dto.hourlyRate);
    }
    if (dto.fixedPrice !== undefined) {
      data.fixedPrice = new Prisma.Decimal(dto.fixedPrice);
    }
    if (dto.currency !== undefined) data.currency = dto.currency;
    if (dto.status !== undefined) {
      // DTO enum is canonical (ACTIVE | DONE | ARCHIVED) — matches Prisma.
      data.status = dto.status;
    }

    const updated = await this.prisma.project.update({
      where: { id },
      data,
    });
    this.logger.log(`project.update id=${id} userId=${userId}`);
    return this.serialize(updated);
  }

  /**
   * Delete a project. Safe-by-default: only ARCHIVED projects are deleted
   * without `force=true`. Anything else throws 409 so we don't nuke active
   * work on an accidental DELETE from the bot.
   */
  async delete(userId: string, id: string, force: boolean) {
    const project = await this.assertOwnership(userId, id);
    if (project.status !== 'ARCHIVED' && !force) {
      throw new ConflictException('Project is not archived. Archive it first or pass ?force=true.');
    }
    await this.prisma.project.delete({ where: { id } });
    this.logger.log(`project.delete id=${id} userId=${userId} force=${force}`);
    return { ok: true };
  }

  /**
   * Monthly rollup — the headline "реальная ставка" insight.
   *
   * - `totalIncome` = (hourlyRate * hours) OR fixedPrice (only if project is
   *   DONE — fixed price is realised only once delivered).
   * - `realHourlyRate` = totalIncome / hours.
   * - `insight` is a short Russian-language explanation using rate thresholds
   *   (RUB-based bands: <500 / 500–1500 / 1500–3000 / >3000).
   *
   * @param month format `YYYY-MM`
   */
  async monthlySummary(userId: string, id: string, month: string): Promise<ProjectMonthlySummary> {
    const project = await this.assertOwnership(userId, id);

    const parsed = parse(`${month}-01`, 'yyyy-MM-dd', new Date());
    if (Number.isNaN(parsed.getTime())) {
      throw new NotFoundException('Invalid month, expected YYYY-MM');
    }
    const from = startOfMonth(parsed);
    const to = endOfMonth(parsed);

    const agg = await this.prisma.timeEntry.aggregate({
      where: {
        projectId: id,
        startedAt: { gte: from, lte: to },
        endedAt: { not: null },
      },
      _sum: { durationSec: true },
    });
    const totalSeconds = agg._sum.durationSec ?? 0;
    const hours = totalSeconds / 3600;

    const declaredRate = project.hourlyRate != null ? Number(project.hourlyRate) : null;
    const fixedPrice = project.fixedPrice != null ? Number(project.fixedPrice) : null;

    let totalIncome: number | null = null;
    if (declaredRate != null) {
      totalIncome = declaredRate * hours;
    } else if (fixedPrice != null && project.status === 'DONE') {
      totalIncome = fixedPrice;
    }

    const realHourlyRate = totalIncome != null && hours > 0 ? totalIncome / hours : null;

    return {
      projectId: project.id,
      totalSeconds,
      declaredRate: declaredRate ?? null,
      realHourlyRate: realHourlyRate ?? null,
      insight: this.buildInsight({
        hours,
        declaredRate,
        realHourlyRate,
        currency: project.currency,
        status: project.status,
        hasFixedPrice: fixedPrice != null,
      }),
    };
  }

  // ---------- helpers ----------

  private async assertOwnership(userId: string, id: string) {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) throw new NotFoundException('Project not found');
    if (project.userId !== userId) {
      throw new ForbiddenException('Not your project');
    }
    return project;
  }

  private serialize(p: {
    id: string;
    userId: string;
    name: string;
    description: string | null;
    hourlyRate: Prisma.Decimal | null;
    fixedPrice: Prisma.Decimal | null;
    currency: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: p.id,
      userId: p.userId,
      name: p.name,
      description: p.description,
      hourlyRate: p.hourlyRate != null ? Number(p.hourlyRate) : null,
      fixedPrice: p.fixedPrice != null ? Number(p.fixedPrice) : null,
      currency: p.currency,
      status: p.status,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  }

  private buildInsight(args: {
    hours: number;
    declaredRate: number | null;
    realHourlyRate: number | null;
    currency: string;
    status: string;
    hasFixedPrice: boolean;
  }): string {
    const { hours, declaredRate, realHourlyRate, currency, status, hasFixedPrice } = args;
    const hoursStr = this.formatHours(hours);

    if (hours === 0) {
      return 'В этом месяце по проекту нет записанного времени.';
    }

    if (realHourlyRate == null) {
      if (hasFixedPrice && status !== 'DONE') {
        return `На этот проект ты потратил ${hoursStr} часов. Проект с фиксированной ценой ещё не завершён — реальная ставка будет посчитана после статуса DONE.`;
      }
      return `На этот проект ты потратил ${hoursStr} часов. Добавь ставку или фикс-цену, чтобы увидеть реальную почасовую.`;
    }

    const rateStr = this.formatRate(realHourlyRate, currency);
    const band = this.rateBand(realHourlyRate, currency);

    const comparison =
      declaredRate != null && Math.abs(declaredRate - realHourlyRate) > 1
        ? realHourlyRate < declaredRate
          ? ` Это ниже заявленной ставки ${this.formatRate(declaredRate, currency)}.`
          : ` Это выше заявленной ставки ${this.formatRate(declaredRate, currency)}.`
        : '';

    return `На этот проект ты потратил ${hoursStr} часов, реальная ставка ${rateStr} — ${band}.${comparison}`;
  }

  private rateBand(rate: number, currency: string): string {
    // Thresholds are calibrated for RUB; other currencies get a neutral band.
    if (currency !== 'RUB') {
      return 'сравни с твоей обычной ставкой в этой валюте';
    }
    if (rate < 500) return 'это ниже рынка';
    if (rate < 1500) return 'это средний уровень новичка';
    if (rate < 3000) return 'это хорошая рыночная ставка';
    return 'это топ-ставка, так держать';
  }

  private formatHours(hours: number): string {
    if (hours < 1) return hours.toFixed(2);
    if (hours < 10) return hours.toFixed(1);
    return Math.round(hours).toString();
  }

  private formatRate(rate: number, currency: string): string {
    const rounded = Math.round(rate);
    const symbol = currency === 'RUB' ? '₽' : currency;
    return `${rounded} ${symbol}/час`;
  }
}
