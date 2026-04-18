import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type {
  CompanyLateStats,
  CompanyRanking,
  OvertimeReport,
  UserRealHourlyRate,
} from '@tact/types';

import { PrismaService } from '@/common/prisma.service';

import {
  LATE_GRACE_MINUTES,
  buildMonthRange,
  computeLateMinutes,
  computeOvertime,
  groupByDay,
  groupByEmployee,
  isWeekend,
  lastNMonths,
  localParts,
  punctualityScore,
} from './analytics.helpers';

interface CompanySummary {
  totalEmployees: number;
  avgLateMinutes: number;
  totalLateCount: number;
  totalOvertimeHours: number;
  punctualityScore: number;
}

interface ProjectBreakdownRow {
  projectId: string;
  name: string;
  seconds: number;
  income: number;
  currency: string;
  excluded: boolean;
  reason?: string;
}

interface UserRealHourlyRateWithBreakdown extends UserRealHourlyRate {
  perProject: ProjectBreakdownRow[];
}

interface RateHistoryPoint {
  month: string;
  periodStart: string;
  periodEnd: string;
  totalSeconds: number;
  totalIncome: number;
  effectiveRate: number;
  currency: string;
}

/**
 * Analytics queries backing the B2B dashboard (company-level punctuality /
 * overtime reports) and the B2C dashboard (per-user real hourly rate).
 *
 * Where we need GROUP BY on date_trunc or multi-step aggregates, we drop to
 * `prisma.$queryRaw`. For simpler joins the typed Prisma client is clearer
 * and safer.
 */
@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Company-level (B2B)
  // ---------------------------------------------------------------------------

  async getCompanyLateStats(
    companyId: string,
    month: string,
  ): Promise<CompanyLateStats[]> {
    const company = await this.loadCompany(companyId);
    const { start, end } = buildMonthRange(month);

    const employees = await this.prisma.employee.findMany({
      where: { companyId, status: 'ACTIVE' },
      select: {
        id: true,
        user: { select: { firstName: true, lastName: true } },
        checkIns: {
          where: {
            type: 'IN',
            timestamp: { gte: start, lte: end },
          },
          select: { id: true, timestamp: true },
        },
      },
    });

    return employees.map((emp) => {
      // Only count one late event per local day (the first IN of the day).
      const byDay = groupByDay(emp.checkIns, company.timezone);
      let lateCount = 0;
      let totalLateMinutes = 0;
      for (const [, dayCheckIns] of byDay) {
        const first = [...dayCheckIns].sort(
          (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
        )[0];
        if (!first) continue;
        const { hour, minute } = localParts(first.timestamp, company.timezone);
        const lateMin = computeLateMinutes(
          hour,
          minute,
          company.workStartHour,
          LATE_GRACE_MINUTES,
        );
        if (lateMin > 0) {
          lateCount += 1;
          totalLateMinutes += lateMin;
        }
      }
      const avgLateMinutes =
        lateCount > 0
          ? Math.round((totalLateMinutes / lateCount) * 100) / 100
          : 0;
      return {
        employeeId: emp.id,
        name: this.fullName(emp.user.firstName, emp.user.lastName),
        lateCount,
        avgLateMinutes,
        totalLateMinutes,
      };
    });
  }

  async getCompanyRanking(
    companyId: string,
    month: string,
    limit = 10,
  ): Promise<CompanyRanking[]> {
    const stats = await this.getCompanyLateStats(companyId, month);

    const scored = stats
      .map((s) => {
        // If the employee has no lates we consider them perfectly punctual;
        // otherwise score against their daily average.
        const score = punctualityScore(s.avgLateMinutes);
        return {
          employeeId: s.employeeId,
          name: s.name,
          punctualityScore: score,
        };
      })
      .sort((a, b) => b.punctualityScore - a.punctualityScore)
      .slice(0, Math.max(1, limit));

    return scored.map((s, idx) => ({
      rank: idx + 1,
      employeeId: s.employeeId,
      name: s.name,
      punctualityScore: s.punctualityScore,
    }));
  }

  async getCompanyOvertime(
    companyId: string,
    month: string,
  ): Promise<OvertimeReport[]> {
    const company = await this.loadCompany(companyId);
    const { start, end } = buildMonthRange(month);

    const employees = await this.prisma.employee.findMany({
      where: { companyId, status: 'ACTIVE' },
      select: {
        id: true,
        user: { select: { firstName: true, lastName: true } },
        checkIns: {
          where: { timestamp: { gte: start, lte: end } },
          select: { id: true, type: true, timestamp: true },
          orderBy: { timestamp: 'asc' },
        },
      },
    });

    return employees.map((emp) => {
      const byDay = groupByDay(emp.checkIns, company.timezone);
      let overtimeHours = 0;
      for (const [, dayCheckIns] of byDay) {
        const ins = dayCheckIns
          .filter((c) => c.type === 'IN')
          .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        const outs = dayCheckIns
          .filter((c) => c.type === 'OUT')
          .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        const firstIn = ins[0];
        const lastOut = outs[outs.length - 1];
        if (!firstIn || !lastOut) continue;

        const outParts = localParts(lastOut.timestamp, company.timezone);
        const inParts = localParts(firstIn.timestamp, company.timezone);
        const ot = computeOvertime(
          outParts.hour,
          outParts.minute,
          inParts.hour,
          inParts.minute,
          company.workEndHour,
          isWeekend(outParts.weekday),
        );
        overtimeHours += ot;
      }
      return {
        employeeId: emp.id,
        name: this.fullName(emp.user.firstName, emp.user.lastName),
        overtimeHours: Math.round(overtimeHours * 100) / 100,
      };
    });
  }

  async getCompanySummary(
    companyId: string,
    month: string,
  ): Promise<CompanySummary> {
    const [lateStats, overtime, employeeCount] = await Promise.all([
      this.getCompanyLateStats(companyId, month),
      this.getCompanyOvertime(companyId, month),
      this.prisma.employee.count({
        where: { companyId, status: 'ACTIVE' },
      }),
    ]);

    const totalLateCount = lateStats.reduce((acc, s) => acc + s.lateCount, 0);
    const totalLateMinutes = lateStats.reduce(
      (acc, s) => acc + s.totalLateMinutes,
      0,
    );
    const avgLateMinutes =
      totalLateCount > 0
        ? Math.round((totalLateMinutes / totalLateCount) * 100) / 100
        : 0;
    const totalOvertimeHours =
      Math.round(
        overtime.reduce((acc, o) => acc + o.overtimeHours, 0) * 100,
      ) / 100;

    return {
      totalEmployees: employeeCount,
      avgLateMinutes,
      totalLateCount,
      totalOvertimeHours,
      punctualityScore: punctualityScore(avgLateMinutes),
    };
  }

  // ---------------------------------------------------------------------------
  // User-level (B2C)
  // ---------------------------------------------------------------------------

  async getUserRealHourlyRate(
    userId: string,
    month: string,
  ): Promise<UserRealHourlyRateWithBreakdown> {
    const { start, end } = buildMonthRange(month);

    // Aggregate seconds per project via raw SQL — cheap and avoids shipping
    // every TimeEntry row over the wire.
    const perProjectSeconds = await this.prisma.$queryRaw<
      Array<{ projectId: string; totalSeconds: bigint }>
    >`
      SELECT te."projectId" AS "projectId",
             COALESCE(SUM(te."durationSec"), 0)::bigint AS "totalSeconds"
      FROM "TimeEntry" te
      JOIN "Project" p ON p."id" = te."projectId"
      WHERE p."userId" = ${userId}
        AND te."startedAt" >= ${start}
        AND te."startedAt" <= ${end}
      GROUP BY te."projectId"
    `;

    const projectIds = perProjectSeconds.map((r) => r.projectId);
    const projects = projectIds.length
      ? await this.prisma.project.findMany({
          where: { id: { in: projectIds } },
          select: {
            id: true,
            name: true,
            hourlyRate: true,
            fixedPrice: true,
            currency: true,
            status: true,
          },
        })
      : [];
    const projectById = new Map(projects.map((p) => [p.id, p]));

    const perProject: ProjectBreakdownRow[] = [];
    let totalSeconds = 0;
    let totalIncome = 0;

    for (const row of perProjectSeconds) {
      const seconds = Number(row.totalSeconds);
      const project = projectById.get(row.projectId);
      if (!project) continue;
      const hours = seconds / 3600;

      let income = 0;
      let excluded = false;
      let reason: string | undefined;

      if (project.status === 'DONE' && project.fixedPrice != null) {
        income = Number(project.fixedPrice);
      } else if (project.hourlyRate != null) {
        income = Number(project.hourlyRate) * hours;
      } else {
        excluded = true;
        reason = 'no hourlyRate or fixedPrice configured';
      }

      if (!excluded) {
        totalSeconds += seconds;
        totalIncome += income;
      }

      perProject.push({
        projectId: project.id,
        name: project.name,
        seconds,
        income: Math.round(income * 100) / 100,
        currency: project.currency,
        excluded,
        reason,
      });
    }

    const totalHours = totalSeconds / 3600;
    const effectiveRate =
      totalHours > 0 ? Math.round((totalIncome / totalHours) * 100) / 100 : 0;

    return {
      userId,
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
      totalSeconds,
      totalIncome: Math.round(totalIncome * 100) / 100,
      effectiveRate,
      perProject,
    };
  }

  async getProjectRateHistory(
    userId: string,
    projectId: string,
    months = 6,
  ): Promise<RateHistoryPoint[]> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId },
      select: {
        id: true,
        name: true,
        hourlyRate: true,
        fixedPrice: true,
        currency: true,
        status: true,
      },
    });
    if (!project) {
      throw new NotFoundException('Project not found');
    }

    const now = new Date();
    const currentMonth = `${now.getUTCFullYear()}-${String(
      now.getUTCMonth() + 1,
    ).padStart(2, '0')}`;
    const bucketLabels = lastNMonths(
      currentMonth,
      Math.max(1, Math.min(36, months)),
    );
    const { start: rangeStart } = buildMonthRange(bucketLabels[0]!);
    const { end: rangeEnd } = buildMonthRange(
      bucketLabels[bucketLabels.length - 1]!,
    );

    // One trip to the DB for all relevant time entries; bucket in-memory so we
    // can reuse the same income-attribution rules as the real-rate query.
    const entries = await this.prisma.timeEntry.findMany({
      where: {
        projectId,
        startedAt: { gte: rangeStart, lte: rangeEnd },
      },
      select: { startedAt: true, durationSec: true },
    });

    const buckets = new Map<string, number>();
    for (const label of bucketLabels) buckets.set(label, 0);
    for (const e of entries) {
      const label = `${e.startedAt.getUTCFullYear()}-${String(
        e.startedAt.getUTCMonth() + 1,
      ).padStart(2, '0')}`;
      if (buckets.has(label)) {
        buckets.set(label, (buckets.get(label) ?? 0) + (e.durationSec ?? 0));
      }
    }

    const points: RateHistoryPoint[] = [];
    for (const label of bucketLabels) {
      const seconds = buckets.get(label) ?? 0;
      const hours = seconds / 3600;
      let income = 0;
      if (project.status === 'DONE' && project.fixedPrice != null) {
        // Fixed-price income is only "earned" in the month the project was
        // completed — we can't tell here without more fields, so amortise it
        // evenly over the buckets containing work on the project.
        income = 0; // placeholder, filled below
      } else if (project.hourlyRate != null) {
        income = Number(project.hourlyRate) * hours;
      }
      const { start, end } = buildMonthRange(label);
      points.push({
        month: label,
        periodStart: start.toISOString(),
        periodEnd: end.toISOString(),
        totalSeconds: seconds,
        totalIncome: Math.round(income * 100) / 100,
        effectiveRate:
          hours > 0 ? Math.round((income / hours) * 100) / 100 : 0,
        currency: project.currency,
      });
    }

    // Amortise fixed-price income across buckets with actual work.
    if (project.status === 'DONE' && project.fixedPrice != null) {
      const working = points.filter((p) => p.totalSeconds > 0);
      if (working.length > 0) {
        const slice = Number(project.fixedPrice) / working.length;
        for (const p of working) {
          p.totalIncome = Math.round(slice * 100) / 100;
          const hours = p.totalSeconds / 3600;
          p.effectiveRate =
            hours > 0 ? Math.round((slice / hours) * 100) / 100 : 0;
        }
      }
    }

    return points;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async loadCompany(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        timezone: true,
        workStartHour: true,
        workEndHour: true,
      },
    });
    if (!company) {
      throw new NotFoundException('Company not found');
    }
    return company;
  }

  private fullName(first: string, last: string | null | undefined): string {
    return last ? `${first} ${last}` : first;
  }
}

// Expose for downstream consumers (e.g. OpenAPI types in controllers).
export type {
  CompanySummary,
  ProjectBreakdownRow,
  RateHistoryPoint,
  UserRealHourlyRateWithBreakdown,
};

// Deliberately re-export utility for testing without relying on
// analytics.helpers being stable part of the module's public API.
export { groupByEmployee };
