import { Injectable, NotFoundException } from '@nestjs/common';
import { CheckInType } from '@prisma/client';

import { PrismaService } from '@/common/prisma.service';

/** A single item in the company live-activity feed. */
export interface ActivityItem {
  id: string;
  employeeName: string;
  type: 'IN' | 'OUT';
  /** ISO-8601 timestamp of the check-in. */
  timestamp: string;
  /** True if this is the employee's first IN of the (company-local) day and it
   *  happened more than 30 minutes after company.workStartHour. */
  late: boolean;
}

/**
 * Returns the wall-clock {hour, minute} of `date` in the given IANA timezone.
 * Uses the built-in Intl machinery so no tz library is needed.
 */
function localHourMinute(date: Date, timeZone: string): { hour: number; minute: number } {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    return { hour, minute };
  } catch {
    // Unknown timezone string — fall back to UTC.
    return { hour: date.getUTCHours(), minute: date.getUTCMinutes() };
  }
}

/** Returns the YYYY-MM-DD calendar date of `date` in the given timezone. */
function localDateKey(date: Date, timeZone: string): string {
  try {
    // en-CA gives ISO-ish YYYY-MM-DD formatting.
    return new Intl.DateTimeFormat('en-CA', { timeZone }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Recent check-ins for a company, newest first, joined with the employee's
   * user record. Caller authorization (must be OWNER/MANAGER) is enforced by
   * the controller's CompanyRoleGuard.
   */
  async recentForCompany(companyId: string, limit = 20): Promise<ActivityItem[]> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { timezone: true, workStartHour: true },
    });
    if (!company) throw new NotFoundException('Company not found');

    const safeLimit = Math.min(Math.max(1, Math.floor(limit) || 20), 100);

    const rows = await this.prisma.checkIn.findMany({
      where: { employee: { companyId } },
      orderBy: { timestamp: 'desc' },
      take: safeLimit,
      select: {
        id: true,
        type: true,
        timestamp: true,
        employeeId: true,
        employee: {
          select: { user: { select: { firstName: true, lastName: true } } },
        },
      },
    });

    // To know whether a given IN is the employee's *first* IN of the local
    // day, we look at the distinct local dates present in this window and pull
    // the earliest IN per (employee, localDate). Doing it from the same rows
    // would be wrong near the window edge, so we query just the relevant INs.
    const timeZone = company.timezone || 'Asia/Almaty';
    const startMinute = company.workStartHour * 60 + 30;

    // Earliest timestamp in this batch — bound the first-IN lookup.
    const earliest = rows.reduce<Date | null>(
      (min, r) => (min == null || r.timestamp < min ? r.timestamp : min),
      null,
    );

    const firstInByKey = new Map<string, string>(); // `${employeeId}:${dateKey}` -> checkInId
    if (earliest) {
      const employeeIds = [...new Set(rows.map((r) => r.employeeId))];
      const candidateIns = await this.prisma.checkIn.findMany({
        where: {
          employeeId: { in: employeeIds },
          type: CheckInType.IN,
          // A safe lower bound: 1 day before the earliest row covers any
          // timezone offset comfortably.
          timestamp: { gte: new Date(earliest.getTime() - 24 * 60 * 60 * 1000) },
        },
        orderBy: { timestamp: 'asc' },
        select: { id: true, employeeId: true, timestamp: true },
      });
      for (const ci of candidateIns) {
        const key = `${ci.employeeId}:${localDateKey(ci.timestamp, timeZone)}`;
        if (!firstInByKey.has(key)) firstInByKey.set(key, ci.id);
      }
    }

    return rows.map((r) => {
      const employeeName =
        [r.employee.user.firstName, r.employee.user.lastName].filter(Boolean).join(' ') || '—';
      let late = false;
      if (r.type === CheckInType.IN) {
        const key = `${r.employeeId}:${localDateKey(r.timestamp, timeZone)}`;
        if (firstInByKey.get(key) === r.id) {
          const { hour, minute } = localHourMinute(r.timestamp, timeZone);
          late = hour * 60 + minute > startMinute;
        }
      }
      return {
        id: r.id,
        employeeName,
        type: r.type === CheckInType.IN ? 'IN' : 'OUT',
        timestamp: r.timestamp.toISOString(),
        late,
      };
    });
  }
}
