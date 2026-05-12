import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '@/common/prisma.service';
import { buildMonthRange, groupByDay } from '@/modules/analytics/analytics.helpers';
import { LatePenaltyService } from '@/modules/billing/late-penalty.service';

export type PayrollBasis = 'salary' | 'hourly' | 'none';

export interface PayrollEmployeeRow {
  id: string;
  name: string;
  position: string | null;
  basis: PayrollBasis;
  monthlySalary: number | null;
  hourlyRate: number | null;
  expectedHours: number;
  workedHours: number;
  deltaHours: number;
  estimatedPay: number | null;
  /** Optional pro-rated figure for salaried staff (salary x daysAttended / workingDays). */
  proratedPay: number | null;
  /** Number of late-arrival days this month (0 when late penalties are disabled). */
  penaltyDays: number;
  /** Total late-arrival deduction for the month. */
  penaltyTotal: number;
  /** estimatedPay (or 0) minus penaltyTotal. */
  netPay: number;
}

export interface PayrollReport {
  year: number;
  month: number;
  workingDays: number;
  employees: PayrollEmployeeRow[];
  totals: {
    penaltyTotal: number;
  };
}

/**
 * Convert a Prisma `Decimal` (or null) to a plain JS number. We never want a
 * Decimal/BigInt leaking into a JSON response, so every numeric column that
 * originates from the DB passes through here.
 */
function decimalToNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Count Monday–Friday days in a given calendar month.
 */
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
 * PayrollService — produces a best-effort monthly payroll estimate for a
 * company based on configured salary/hourly rates and recorded check-ins.
 *
 * Figures are estimates: a dangling IN with no matching OUT contributes zero
 * hours (we deliberately keep this simple rather than guessing an end time).
 */
@Injectable()
export class PayrollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly latePenalty: LatePenaltyService,
  ) {}

  async getPayroll(companyId: string, month: string): Promise<PayrollReport> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        timezone: true,
        workStartHour: true,
        workEndHour: true,
      },
    });
    if (!company) throw new NotFoundException('Company not found');

    const { start, end } = buildMonthRange(month);
    const [yearStr, monthStr] = month.split('-');
    const year = Number(yearStr);
    const monthNum = Number(monthStr);

    const workingDays = countWorkingDays(year, monthNum - 1);
    const hoursPerDay = Math.max(0, company.workEndHour - company.workStartHour);
    const expectedHours = round1(workingDays * hoursPerDay);

    const employees = await this.prisma.employee.findMany({
      where: { companyId: company.id, status: 'ACTIVE', role: { not: 'OWNER' } },
      select: {
        id: true,
        position: true,
        monthlySalary: true,
        hourlyRate: true,
        user: { select: { firstName: true, lastName: true } },
        checkIns: {
          where: { timestamp: { gte: start, lte: end } },
          select: { id: true, type: true, timestamp: true },
          orderBy: { timestamp: 'asc' },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Late-arrival penalties for the same month, indexed by employee id.
    const penalties = await this.latePenalty.computeMonthlyPenalties(company.id, month);
    const penaltyByEmployee = new Map(
      penalties.employees.map((p) => [p.employeeId, p]),
    );

    const rows: PayrollEmployeeRow[] = employees.map((emp) => {
      const { workedHours, daysAttended } = this.sumWorkedHours(
        emp.checkIns,
        company.timezone,
      );

      const monthlySalary = decimalToNumber(emp.monthlySalary);
      const hourlyRate = decimalToNumber(emp.hourlyRate);

      let basis: PayrollBasis = 'none';
      let estimatedPay: number | null = null;
      let proratedPay: number | null = null;

      if (hourlyRate !== null) {
        basis = 'hourly';
        estimatedPay = round2(hourlyRate * workedHours);
      } else if (monthlySalary !== null) {
        basis = 'salary';
        estimatedPay = round2(monthlySalary);
        proratedPay =
          workingDays > 0
            ? round2(monthlySalary * (daysAttended / workingDays))
            : 0;
      }

      const name = emp.user.lastName
        ? `${emp.user.firstName} ${emp.user.lastName}`
        : emp.user.firstName;

      const pen = penaltyByEmployee.get(emp.id);
      const penaltyDays = pen?.lateDays ?? 0;
      const penaltyTotal = round2(pen?.totalPenalty ?? 0);
      const netPay = round2((estimatedPay ?? 0) - penaltyTotal);

      return {
        id: emp.id,
        name,
        position: emp.position ?? null,
        basis,
        monthlySalary,
        hourlyRate,
        expectedHours,
        workedHours: round1(workedHours),
        deltaHours: round1(workedHours - expectedHours),
        estimatedPay,
        proratedPay,
        penaltyDays,
        penaltyTotal,
        netPay,
      };
    });

    const penaltyTotalAll = round2(rows.reduce((s, r) => s + r.penaltyTotal, 0));

    return {
      year,
      month: monthNum,
      workingDays,
      employees: rows,
      totals: { penaltyTotal: penaltyTotalAll },
    };
  }

  /**
   * Pair a month's check-ins chronologically (IN then OUT) within each local
   * day and sum the durations. A dangling IN with no OUT contributes 0 hours.
   * `daysAttended` counts local days with at least one completed IN→OUT pair
   * (falls back to days with any IN if no pairs that day) — used for salary
   * pro-rating.
   */
  private sumWorkedHours(
    checkIns: Array<{ type: string; timestamp: Date }>,
    timezone: string,
  ): { workedHours: number; daysAttended: number } {
    const byDay = groupByDay(checkIns, timezone);
    let totalSeconds = 0;
    let daysAttended = 0;

    for (const [, dayCheckIns] of byDay) {
      const sorted = [...dayCheckIns].sort(
        (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
      );
      let openIn: Date | null = null;
      let pairedThisDay = false;
      let sawAnyIn = false;
      for (const ci of sorted) {
        if (ci.type === 'IN') {
          sawAnyIn = true;
          // If there's already an open IN, the previous one is dangling → 0.
          openIn = ci.timestamp;
        } else if (ci.type === 'OUT') {
          if (openIn) {
            totalSeconds += Math.max(0, (ci.timestamp.getTime() - openIn.getTime()) / 1000);
            openIn = null;
            pairedThisDay = true;
          }
          // OUT with no matching IN → ignored.
        }
      }
      if (pairedThisDay || sawAnyIn) daysAttended += 1;
    }

    return { workedHours: totalSeconds / 3600, daysAttended };
  }
}
