import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AbsenceType } from '@prisma/client';

import { PrismaService } from '@/common/prisma.service';
import {
  buildMonthRange,
  groupByDay,
  isWeekend,
  localParts,
} from '@/modules/analytics/analytics.helpers';
import { effectiveWorkHours } from '@/modules/analytics/work-hours.util';

/** Minutes of grace before an IN counts as "late" for the timesheet. */
const LATE_GRACE_MINUTES = 30;

export type TimesheetCellState =
  | 'present'
  | 'late'
  | 'vacation'
  | 'sick'
  | 'dayoff'
  | 'trip'
  | 'weekend'
  | 'absent';

export interface TimesheetEmployeeRow {
  id: string;
  name: string;
  position: string | null;
  cells: Record<string, TimesheetCellState>;
}

export interface TimesheetResult {
  year: number;
  month: number;
  days: number;
  employees: TimesheetEmployeeRow[];
}

const ABSENCE_STATE: Record<AbsenceType, TimesheetCellState> = {
  VACATION: 'vacation',
  SICK_LEAVE: 'sick',
  DAY_OFF: 'dayoff',
  BUSINESS_TRIP: 'trip',
};

/**
 * TimesheetService — builds the monthly "Табель" grid: one cell per active
 * non-OWNER employee per calendar day, classifying each day as a leave type,
 * an on-time / late attendance, a weekend, or an unexplained absence.
 *
 * Timezone handling reuses the analytics helpers (`groupByDay`, `localParts`)
 * so the day boundaries and "late" calculations line up with the rest of the
 * dashboard. No Decimal/BigInt fields are selected, so nothing un-serialisable
 * leaks into the JSON response.
 */
@Injectable()
export class TimesheetService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * @param companyId  target company
   * @param month      `YYYY-MM`
   * @param requesterUserId  caller — must be an ACTIVE OWNER/MANAGER
   */
  async getTimesheet(
    companyId: string,
    month: string,
    requesterUserId: string,
  ): Promise<TimesheetResult> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, timezone: true, workStartHour: true, workEndHour: true },
    });
    if (!company) throw new NotFoundException('Company not found');

    const membership = await this.prisma.employee.findFirst({
      where: {
        companyId,
        userId: requesterUserId,
        role: { in: ['OWNER', 'MANAGER'] },
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    if (!membership) {
      throw new ForbiddenException('Caller is not an OWNER or MANAGER of this company');
    }

    const { start, end } = buildMonthRange(month);
    const year = start.getFullYear();
    const monthNum = start.getMonth() + 1;
    const daysInMonth = end.getDate();

    const employees = await this.prisma.employee.findMany({
      where: {
        companyId,
        status: 'ACTIVE',
        role: { not: 'OWNER' },
      },
      select: {
        id: true,
        position: true,
        workStartHour: true,
        workEndHour: true,
        shift: { select: { startHour: true, endHour: true } },
        user: { select: { firstName: true, lastName: true } },
        checkIns: {
          where: { type: 'IN', timestamp: { gte: start, lte: end } },
          select: { type: true, timestamp: true },
          orderBy: { timestamp: 'asc' },
        },
        absences: {
          where: { startDate: { lte: end }, endDate: { gte: start } },
          select: { type: true, startDate: true, endDate: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const dayKeyFmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: company.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    // `YYYY-MM-DD` (company-local) per day number.
    const dayKeys: string[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      dayKeys.push(`${year}-${String(monthNum).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    }

    const rows: TimesheetEmployeeRow[] = employees.map((emp) => {
      const name = emp.user.lastName
        ? `${emp.user.firstName} ${emp.user.lastName}`
        : emp.user.firstName;

      // Absence type per local day key.
      const absenceByDay = new Map<string, TimesheetCellState>();
      for (const ab of emp.absences) {
        // Walk every day the absence spans, then intersect with this month.
        const cursor = new Date(ab.startDate);
        const last = new Date(ab.endDate);
        while (cursor.getTime() <= last.getTime()) {
          const key = dayKeyFmt.format(cursor);
          if (!absenceByDay.has(key)) absenceByDay.set(key, ABSENCE_STATE[ab.type]);
          cursor.setDate(cursor.getDate() + 1);
        }
      }

      // First IN per local day key.
      const insByDay = groupByDay(emp.checkIns, company.timezone);

      const cells: Record<string, TimesheetCellState> = {};
      for (let d = 1; d <= daysInMonth; d++) {
        const key = dayKeys[d - 1]!;

        const absence = absenceByDay.get(key);
        if (absence) {
          cells[String(d)] = absence;
          continue;
        }

        const ins = insByDay.get(key);
        if (ins && ins.length > 0) {
          const firstIn = ins.reduce((a, b) =>
            a.timestamp.getTime() <= b.timestamp.getTime() ? a : b,
          );
          const { hour, minute } = localParts(firstIn.timestamp, company.timezone);
          const minutesIntoDay = hour * 60 + minute;
          const { start } = effectiveWorkHours(emp, company);
          const cutoff = start * 60 + LATE_GRACE_MINUTES;
          cells[String(d)] = minutesIntoDay > cutoff ? 'late' : 'present';
          continue;
        }

        // No attendance, no leave — Sat/Sun is a weekend, anything else an
        // unexplained absence. Use UTC noon so the weekday of the calendar
        // date is unambiguous regardless of the server's local zone.
        const weekday = new Date(`${key}T12:00:00Z`).getUTCDay();
        cells[String(d)] = isWeekend(weekday) ? 'weekend' : 'absent';
      }

      return { id: emp.id, name, position: emp.position ?? null, cells };
    });

    return { year, month: monthNum, days: daysInMonth, employees: rows };
  }
}
