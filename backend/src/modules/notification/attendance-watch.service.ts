import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CheckInType, EmployeeRole } from '@prisma/client';

import { PrismaService } from '@/common/prisma.service';
import { effectiveWorkHours } from '@/modules/analytics/work-hours.util';
import { BotService } from '@/modules/telegram/bot.service';

/**
 * AttendanceWatchService
 *
 * Two scheduled jobs that nudge company owners/managers over Telegram:
 *
 *  1. Every 15 min — for each company, if the local clock is past
 *     workStartHour + 30 min, report any ACTIVE non-OWNER employee with no
 *     `IN` check-in for the current local day. Each missing employee is
 *     reported at most once per local day (in-memory dedup set).
 *
 *  2. Once per day, when the local hour reaches workEndHour — send a digest:
 *     "present/total on site, N late".
 *
 * Per-company work is wrapped in try/catch so one misconfigured company
 * (e.g. a bad timezone) doesn't abort the whole sweep.
 */
@Injectable()
export class AttendanceWatchService {
  private readonly logger = new Logger(AttendanceWatchService.name);

  /** Keys `${companyId}:${employeeId}:${YYYY-MM-DD}` already reported missing. */
  private readonly missingReported = new Set<string>();
  /** Keys `${companyId}:${YYYY-MM-DD}` whose end-of-day digest was already sent. */
  private readonly digestSent = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly bot: BotService,
  ) {}

  // ---------------------------------------------------------------------------
  // Job 1: missing-checkin nudges, every 15 minutes
  // ---------------------------------------------------------------------------
  @Cron('*/15 * * * *')
  async checkMissingCheckins(): Promise<void> {
    const companies = await this.loadCompanies();

    // Opportunistically prune stale dedup entries (keys not for "today" in any
    // company). Cheap and keeps the sets from growing without bound.
    this.pruneStaleKeys(companies.map((c) => c.timezone));

    for (const company of companies) {
      try {
        await this.checkMissingForCompany(company);
      } catch (err) {
        this.logger.warn(
          `checkMissingCheckins failed for company=${company.id}: ${(err as Error).message}`,
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Job 2: end-of-day digest, hourly check (sends once per company per day)
  // ---------------------------------------------------------------------------
  @Cron(CronExpression.EVERY_HOUR)
  async sendDailyDigests(): Promise<void> {
    const companies = await this.loadCompanies();

    for (const company of companies) {
      try {
        await this.sendDigestForCompany(company);
      } catch (err) {
        this.logger.warn(
          `sendDailyDigests failed for company=${company.id}: ${(err as Error).message}`,
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Per-company implementations
  // ---------------------------------------------------------------------------

  private async checkMissingForCompany(company: CompanyRow): Promise<void> {
    const tz = company.timezone || 'Asia/Almaty';
    const now = new Date();
    const { hour, minute } = localHourMinute(now, tz);
    const nowMin = hour * 60 + minute;
    const dateKey = localDateKey(now, tz);

    const employees = await this.prisma.employee.findMany({
      where: { companyId: company.id, status: 'ACTIVE', role: { not: EmployeeRole.OWNER } },
      select: {
        id: true,
        user: { select: { firstName: true, lastName: true } },
        workStartHour: true,
        workEndHour: true,
        shift: { select: { startHour: true, endHour: true } },
      },
    });
    if (employees.length === 0) return; // skip empty companies

    const dayStart = localDayStartUtc(now, tz);
    const insToday = await this.prisma.checkIn.findMany({
      where: {
        employee: { companyId: company.id },
        type: CheckInType.IN,
        timestamp: { gte: dayStart },
      },
      select: { employeeId: true },
    });
    const arrived = new Set(insToday.map((c) => c.employeeId));

    // Only nag an employee once *their* grace window (effective start + 30 min)
    // has elapsed in company-local time.
    const missing = employees.filter((e) => {
      if (arrived.has(e.id)) return false;
      const { start } = effectiveWorkHours(e, company);
      return nowMin > start * 60 + 30;
    });
    if (missing.length === 0) return;

    // Resolve OWNER/MANAGER telegram ids once.
    const recipients = await this.recipientsFor(company.id);
    if (recipients.length === 0) return;

    for (const emp of missing) {
      const key = `${company.id}:${emp.id}:${dateKey}`;
      if (this.missingReported.has(key)) continue;
      this.missingReported.add(key);

      const name = fullName(emp.user.firstName, emp.user.lastName);
      const msg = `⚠️ ${name} ещё не отметил(ся/ась) сегодня`;
      for (const tgId of recipients) {
        await this.bot
          .notifyUser(tgId, msg)
          .catch((err: Error) => this.logger.warn(`notify missing failed: ${err.message}`));
      }
    }
  }

  private async sendDigestForCompany(company: CompanyRow): Promise<void> {
    const tz = company.timezone || 'Asia/Almaty';
    const now = new Date();
    const { hour } = localHourMinute(now, tz);
    const dateKey = localDateKey(now, tz);

    // Send only once the local clock has reached the configured end hour.
    if (hour < company.workEndHour) return;

    const digestKey = `${company.id}:${dateKey}`;
    if (this.digestSent.has(digestKey)) return;

    const employees = await this.prisma.employee.findMany({
      where: { companyId: company.id, status: 'ACTIVE', role: { not: EmployeeRole.OWNER } },
      select: {
        id: true,
        workStartHour: true,
        workEndHour: true,
        shift: { select: { startHour: true, endHour: true } },
      },
    });
    if (employees.length === 0) {
      // Nothing meaningful to report, but mark as done so we don't re-check
      // every hour for the rest of the day.
      this.digestSent.add(digestKey);
      return;
    }

    const dayStart = localDayStartUtc(now, tz);
    const insToday = await this.prisma.checkIn.findMany({
      where: {
        employee: { companyId: company.id },
        type: CheckInType.IN,
        timestamp: { gte: dayStart },
      },
      orderBy: { timestamp: 'asc' },
      select: { employeeId: true, timestamp: true },
    });

    const firstInByEmployee = new Map<string, Date>();
    for (const ci of insToday) {
      if (!firstInByEmployee.has(ci.employeeId)) firstInByEmployee.set(ci.employeeId, ci.timestamp);
    }

    const empById = new Map(employees.map((e) => [e.id, e]));
    const present = [...firstInByEmployee.keys()].filter((id) => empById.has(id)).length;
    const total = employees.length;

    let lateCount = 0;
    for (const [empId, ts] of firstInByEmployee) {
      const emp = empById.get(empId);
      if (!emp) continue;
      const { start } = effectiveWorkHours(emp, company);
      const { hour: h, minute: m } = localHourMinute(ts, tz);
      if (h * 60 + m > start * 60 + 30) lateCount += 1;
    }

    const recipients = await this.recipientsFor(company.id);
    this.digestSent.add(digestKey);
    if (recipients.length === 0) return;

    const msg = `📊 Сегодня: ${present}/${total} на месте · ${lateCount} опозданий`;
    for (const tgId of recipients) {
      await this.bot
        .notifyUser(tgId, msg)
        .catch((err: Error) => this.logger.warn(`notify digest failed: ${err.message}`));
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async loadCompanies(): Promise<CompanyRow[]> {
    return this.prisma.company.findMany({
      select: { id: true, timezone: true, workStartHour: true, workEndHour: true },
    });
  }

  private async recipientsFor(companyId: string): Promise<bigint[]> {
    const managers = await this.prisma.employee.findMany({
      where: {
        companyId,
        status: 'ACTIVE',
        role: { in: [EmployeeRole.OWNER, EmployeeRole.MANAGER] },
      },
      select: { user: { select: { telegramId: true } } },
    });
    const ids: bigint[] = [];
    for (const m of managers) {
      if (m.user.telegramId != null) ids.push(m.user.telegramId);
    }
    return ids;
  }

  /** Drop dedup keys whose date is not "today" in any tracked timezone. */
  private pruneStaleKeys(timezones: string[]): void {
    const liveDates = new Set<string>();
    const now = new Date();
    for (const tz of timezones) liveDates.add(localDateKey(now, tz || 'Asia/Almaty'));
    // Also keep yesterday's keys briefly to avoid edge churn around midnight.
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    for (const tz of timezones) liveDates.add(localDateKey(yesterday, tz || 'Asia/Almaty'));

    const pruneSet = (set: Set<string>) => {
      for (const key of set) {
        const datePart = key.slice(key.lastIndexOf(':') + 1);
        if (!liveDates.has(datePart)) set.delete(key);
      }
    };
    pruneSet(this.missingReported);
    pruneSet(this.digestSent);
  }
}

interface CompanyRow {
  id: string;
  timezone: string;
  workStartHour: number;
  workEndHour: number;
}

function fullName(first: string, last: string | null): string {
  return [first, last].filter(Boolean).join(' ') || '—';
}

/** Wall-clock {hour, minute} of `date` in the given IANA timezone. */
function localHourMinute(date: Date, timeZone: string): { hour: number; minute: number } {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
    return {
      hour: Number(parts.find((p) => p.type === 'hour')?.value ?? '0'),
      minute: Number(parts.find((p) => p.type === 'minute')?.value ?? '0'),
    };
  } catch {
    return { hour: date.getUTCHours(), minute: date.getUTCMinutes() };
  }
}

/** YYYY-MM-DD calendar date of `date` in the given timezone. */
function localDateKey(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/**
 * The UTC instant corresponding to 00:00 local time of `date` in `timeZone`.
 * Computed by measuring the zone's current offset from the formatted parts.
 */
function localDayStartUtc(date: Date, timeZone: string): Date {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    const parts = fmt.formatToParts(date);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    // offset = (local-wallclock-as-if-UTC) - (real UTC instant)
    const offsetMs = asUtc - date.getTime();
    const localMidnightAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), 0, 0, 0);
    return new Date(localMidnightAsUtc - offsetMs);
  } catch {
    const d = new Date(date);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }
}
