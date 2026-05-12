import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '@/common/prisma.service';
import { buildMonthRange, groupByDay, localParts } from '@/modules/analytics/analytics.helpers';

export interface LatePenaltyDetail {
  date: string; // YYYY-MM-DD (company-local)
  lateMinutes: number;
  penalty: number;
}

export interface LatePenaltyEmployee {
  employeeId: string;
  name: string;
  lateDays: number;
  totalPenalty: number;
  details: LatePenaltyDetail[];
}

export interface LatePenaltyResult {
  enabled: boolean;
  employees: LatePenaltyEmployee[];
}

/** Prisma Decimal | number | null -> plain number (NaN-safe, defaults to 0). */
function toNum(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = Number(value as never);
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Count Monday–Friday days in a calendar month (monthIndex0 is 0-based). */
function countWorkingDays(year: number, monthIndex0: number): number {
  let count = 0;
  const d = new Date(Date.UTC(year, monthIndex0, 1));
  while (d.getUTCMonth() === monthIndex0) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) count += 1;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return count;
}

/**
 * LatePenaltyService — computes month-by-month late-arrival penalties for a
 * company's employees, based on the company's `latePenalty*` configuration,
 * recorded IN check-ins, holidays and approved absences.
 *
 * All local-day arithmetic uses the company timezone via `Intl.DateTimeFormat`.
 */
@Injectable()
export class LatePenaltyService {
  constructor(private readonly prisma: PrismaService) {}

  async computeMonthlyPenalties(companyId: string, month: string): Promise<LatePenaltyResult> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        timezone: true,
        workStartHour: true,
        latePenaltyEnabled: true,
        latePenaltyGraceMin: true,
        latePenaltyAmount: true,
        latePenaltyPercent: true,
        holidays: { select: { date: true } },
      },
    });
    if (!company) throw new NotFoundException('Company not found');

    const { start, end } = buildMonthRange(month);
    const [yearStr, monthStr] = month.split('-');
    const year = Number(yearStr);
    const monthNum = Number(monthStr);
    const workingDaysInMonth = countWorkingDays(year, monthNum - 1);

    const employees = await this.prisma.employee.findMany({
      where: { companyId: company.id, status: 'ACTIVE', role: { not: 'OWNER' } },
      select: {
        id: true,
        monthlySalary: true,
        hourlyRate: true,
        workStartHour: true,
        user: { select: { firstName: true, lastName: true } },
        shift: { select: { startHour: true } },
        checkIns: {
          where: { type: 'IN', timestamp: { gte: start, lte: end } },
          select: { timestamp: true },
          orderBy: { timestamp: 'asc' },
        },
        absences: {
          where: {
            status: 'APPROVED',
            startDate: { lte: end },
            endDate: { gte: start },
          },
          select: { startDate: true, endDate: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const enabled = company.latePenaltyEnabled === true;

    // Pre-compute holiday day-keys (Holiday.date is a @db.Date — use UTC parts).
    const holidayKeys = new Set(
      company.holidays.map((h) => {
        const d = h.date;
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
          d.getUTCDate(),
        ).padStart(2, '0')}`;
      }),
    );

    const fixedAmount = company.latePenaltyAmount == null ? null : toNum(company.latePenaltyAmount);
    const percent = company.latePenaltyPercent ?? 0;
    const graceMin = company.latePenaltyGraceMin ?? 15;
    const companyStart = company.workStartHour;

    const out: LatePenaltyEmployee[] = employees.map((emp) => {
      const name = emp.user.lastName
        ? `${emp.user.firstName} ${emp.user.lastName}`
        : emp.user.firstName;

      if (!enabled) {
        return { employeeId: emp.id, name, lateDays: 0, totalPenalty: 0, details: [] };
      }

      // Daily rate for the percent mode.
      const monthlySalary = emp.monthlySalary == null ? null : toNum(emp.monthlySalary);
      const hourlyRate = emp.hourlyRate == null ? null : toNum(emp.hourlyRate);
      let dailyRate = 0;
      if (monthlySalary != null) {
        dailyRate = workingDaysInMonth > 0 ? monthlySalary / workingDaysInMonth : 0;
      } else if (hourlyRate != null) {
        dailyRate = hourlyRate * 8;
      }
      const perLateDayPenalty =
        fixedAmount != null ? fixedAmount : round2(((percent ?? 0) / 100) * dailyRate);

      const effStart = emp.workStartHour ?? emp.shift?.startHour ?? companyStart;
      const cutoffMin = effStart * 60 + graceMin;

      // Build the set of "off" day-keys from approved absences (full-day spans).
      const offKeys = new Set<string>();
      for (const ab of emp.absences) {
        const cur = new Date(
          Date.UTC(
            ab.startDate.getUTCFullYear(),
            ab.startDate.getUTCMonth(),
            ab.startDate.getUTCDate(),
          ),
        );
        const last = new Date(
          Date.UTC(ab.endDate.getUTCFullYear(), ab.endDate.getUTCMonth(), ab.endDate.getUTCDate()),
        );
        while (cur.getTime() <= last.getTime()) {
          offKeys.add(
            `${cur.getUTCFullYear()}-${String(cur.getUTCMonth() + 1).padStart(2, '0')}-${String(
              cur.getUTCDate(),
            ).padStart(2, '0')}`,
          );
          cur.setUTCDate(cur.getUTCDate() + 1);
        }
      }

      // First IN per company-local day.
      const byDay = groupByDay(emp.checkIns, company.timezone);
      const details: LatePenaltyDetail[] = [];

      for (const [key, ins] of byDay) {
        // Working-day filter: must be a weekday in this month, not a holiday,
        // not covered by an approved absence.
        const [y, m, d] = key.split('-').map((x) => Number(x));
        if (m !== monthNum || y !== year) continue;
        const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
        if (weekday === 0 || weekday === 6) continue;
        if (holidayKeys.has(key)) continue;
        if (offKeys.has(key)) continue;

        const firstIn = [...ins].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())[0];
        if (!firstIn) continue;
        const { hour, minute } = localParts(firstIn.timestamp, company.timezone);
        const actualMin = hour * 60 + minute;
        if (actualMin > cutoffMin) {
          details.push({
            date: key,
            lateMinutes: actualMin - cutoffMin,
            penalty: perLateDayPenalty,
          });
        }
      }

      details.sort((a, b) => a.date.localeCompare(b.date));
      const totalPenalty = round2(details.reduce((s, x) => s + x.penalty, 0));
      return {
        employeeId: emp.id,
        name,
        lateDays: details.length,
        totalPenalty,
        details,
      };
    });

    return { enabled, employees: out };
  }
}
