import { Injectable, NotFoundException } from '@nestjs/common';
import { CheckInType, EmployeeRole, EmployeeStatus } from '@prisma/client';

import { PrismaService } from '@/common/prisma.service';

/** One person currently checked in at the office. */
export interface PresencePerson {
  employeeId: string;
  name: string;
  avatarUrl: string | null;
  /** ISO-8601 timestamp of the IN check-in that put them "in office". */
  sinceTimestamp: string;
  lat: number | null;
  lng: number | null;
}

export interface PresenceSnapshot {
  total: number;
  present: number;
  inOffice: PresencePerson[];
}

/** Returns the YYYY-MM-DD calendar date of `date` in the given timezone. */
function localDateKey(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v as any);
  return Number.isFinite(n) ? n : null;
}

/**
 * PresenceService — "who's in the office right now".
 *
 * PrismaService comes from the @Global() PrismaModule. This provider is
 * registered in CompanyModule (alongside the company overview routes).
 */
@Injectable()
export class PresenceService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Live presence snapshot for a company.
   *
   * "In office" = the employee's *latest* CheckIn whose timestamp falls on the
   * company-local day is of type IN. Caller authorization (OWNER/MANAGER) is
   * enforced by the controller's CompanyRoleGuard.
   */
  async liveForCompany(companyId: string): Promise<PresenceSnapshot> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { timezone: true },
    });
    if (!company) throw new NotFoundException('Company not found');

    const timeZone = company.timezone || 'Asia/Almaty';
    const todayKey = localDateKey(new Date(), timeZone);

    const employees = await this.prisma.employee.findMany({
      where: {
        companyId,
        status: EmployeeStatus.ACTIVE,
        role: { not: EmployeeRole.OWNER },
      },
      select: {
        id: true,
        user: { select: { firstName: true, lastName: true, avatarUrl: true } },
      },
    });

    const total = employees.length;
    if (total === 0) return { total: 0, present: 0, inOffice: [] };

    const employeeIds = employees.map((e) => e.id);

    // Pull recent check-ins (last 48h is plenty to cover any tz day) for these
    // employees, newest first, so the first row per employee is their latest.
    const since = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const rows = await this.prisma.checkIn.findMany({
      where: { employeeId: { in: employeeIds }, timestamp: { gte: since } },
      orderBy: { timestamp: 'desc' },
      select: {
        employeeId: true,
        type: true,
        timestamp: true,
        latitude: true,
        longitude: true,
      },
    });

    const latestByEmployee = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      if (!latestByEmployee.has(r.employeeId)) latestByEmployee.set(r.employeeId, r);
    }

    const byId = new Map(employees.map((e) => [e.id, e]));
    const inOffice: PresencePerson[] = [];
    for (const [employeeId, latest] of latestByEmployee) {
      if (latest.type !== CheckInType.IN) continue;
      if (localDateKey(latest.timestamp, timeZone) !== todayKey) continue;
      const emp = byId.get(employeeId);
      if (!emp) continue;
      const name =
        [emp.user.firstName, emp.user.lastName].filter(Boolean).join(' ') || '—';
      inOffice.push({
        employeeId,
        name,
        avatarUrl: emp.user.avatarUrl ?? null,
        sinceTimestamp: latest.timestamp.toISOString(),
        lat: toNum(latest.latitude),
        lng: toNum(latest.longitude),
      });
    }

    // Stable-ish ordering: longest-present first.
    inOffice.sort((a, b) => a.sinceTimestamp.localeCompare(b.sinceTimestamp));

    return { total, present: inOffice.length, inOffice };
  }
}
