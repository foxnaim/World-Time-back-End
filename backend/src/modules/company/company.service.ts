import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EmployeeRole, EmployeeStatus, Prisma } from '@prisma/client';
import { createId } from '@paralleldrive/cuid2';
import { PrismaService } from '@/common/prisma.service';
import { AuditService } from '@/modules/audit/audit.service';
import { BillingService } from '@/modules/billing/billing.service';
import {
  LATE_GRACE_MINUTES,
  computeLateMinutes,
  groupByDay,
  localParts,
} from '@/modules/analytics/analytics.helpers';
import { InviteTokenService } from './invite-token.service';
import type { CreateCompanyDto } from './dto/create-company.dto';
import type { UpdateCompanyDto } from './dto/update-company.dto';
import type { InviteEmployeeDto } from './dto/invite-employee.dto';

const MAX_SLUG_COLLISION_RETRIES = 5;

/**
 * Turn an arbitrary string into a URL-safe slug.
 * Lowercase, ASCII alnum, single dashes, no leading/trailing dash.
 */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

@Injectable()
export class CompanyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inviteTokens: InviteTokenService,
    private readonly billing: BillingService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Create a company and attach the creator as its OWNER employee in a single
   * transaction. The slug is derived from `name` and disambiguated with a cuid
   * suffix if a collision occurs.
   */
  async create(userId: string, dto: CreateCompanyDto) {
    const baseSlug = slugify(dto.name) || 'company';

    let attempt = 0;
    while (true) {
      const candidate = attempt === 0 ? baseSlug : `${baseSlug}-${createId().slice(0, 6)}`;

      try {
        const company = await this.prisma.$transaction(async (tx) => {
          const created = await tx.company.create({
            data: {
              name: dto.name,
              slug: candidate,
              ownerId: userId,
              address: dto.address,
              latitude: dto.latitude,
              longitude: dto.longitude,
              geofenceRadiusM: dto.geofenceRadiusM,
              timezone: dto.timezone,
              workStartHour: dto.workStartHour,
              workEndHour: dto.workEndHour,
            },
          });

          await tx.employee.create({
            data: {
              userId,
              companyId: created.id,
              role: EmployeeRole.OWNER,
              status: EmployeeStatus.ACTIVE,
              position: 'Owner',
            },
          });

          return created;
        });

        // Provision a default FREE-tier subscription for the new company.
        // Outside the transaction on purpose: a failure here should not roll
        // back company + OWNER creation (the seat guard falls back to FREE
        // defaults when no row exists), but we log + rethrow so callers see
        // the problem in staging.
        await this.billing.createDefaultFreeSubscription(company.id);

        return company;
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002' &&
          attempt < MAX_SLUG_COLLISION_RETRIES
        ) {
          attempt++;
          continue;
        }
        throw err;
      }
    }
  }

  /**
   * All companies where the user is an active employee, annotated with the
   * caller's role in each company.
   */
  async findMyCompanies(userId: string) {
    const memberships = await this.prisma.employee.findMany({
      where: { userId, status: EmployeeStatus.ACTIVE },
      include: { company: true },
      orderBy: { createdAt: 'desc' },
    });

    return memberships.map((m) => ({
      ...m.company,
      myRole: m.role,
    }));
  }

  /**
   * Fetch a company by slug; the caller must be an employee of that company.
   */
  async findBySlug(userId: string, slug: string) {
    const company = await this.prisma.company.findUnique({ where: { slug } });
    if (!company) throw new NotFoundException('Company not found');

    const membership = await this.prisma.employee.findFirst({
      where: { userId, companyId: company.id },
    });
    if (!membership) {
      throw new ForbiddenException('You are not a member of this company');
    }

    return { ...company, myRole: membership.role };
  }

  /**
   * Update a company. Caller must be OWNER or MANAGER (enforced via guard,
   * re-checked here defensively for service-level callers).
   */
  async update(userId: string, companyId: string, dto: UpdateCompanyDto) {
    const membership = await this.prisma.employee.findFirst({
      where: { userId, companyId },
    });
    if (!membership) throw new NotFoundException('Company not found');
    if (membership.role !== EmployeeRole.OWNER && membership.role !== EmployeeRole.MANAGER) {
      throw new ForbiddenException('Only OWNER or MANAGER can update the company');
    }

    return this.prisma.company.update({
      where: { id: companyId },
      data: dto,
    });
  }

  /**
   * Hard-delete a company and all its child rows (check-ins, employees,
   * QR/invite tokens, subscription). OWNER only. Mirrors the cascade we
   * use when deleting the owner's user account.
   */
  async remove(userId: string, companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, ownerId: true, name: true },
    });
    if (!company) throw new NotFoundException('Company not found');
    if (company.ownerId !== userId) {
      throw new ForbiddenException('Only OWNER can delete the company');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.checkIn.deleteMany({ where: { employee: { companyId } } });
      await tx.employee.deleteMany({ where: { companyId } });
      await tx.qRToken.deleteMany({ where: { companyId } });
      await tx.inviteToken.deleteMany({ where: { companyId } });
      await tx.subscription.deleteMany({ where: { companyId } });
      await tx.company.delete({ where: { id: companyId } });
    });

    return { ok: true, deletedId: companyId, name: company.name };
  }

  /**
   * Issue a Telegram deep-link invite token for a future employee.
   * Returns the bot deep-link plus the raw token and expiry.
   */
  async inviteEmployee(userId: string, companyId: string, dto: InviteEmployeeDto) {
    const membership = await this.prisma.employee.findFirst({
      where: { userId, companyId },
    });
    if (
      !membership ||
      (membership.role !== EmployeeRole.OWNER && membership.role !== EmployeeRole.MANAGER)
    ) {
      throw new ForbiddenException('Only OWNER or MANAGER can invite employees');
    }

    const role = (dto.role ?? EmployeeRole.STAFF) as EmployeeRole;
    // Only OWNER can invite another OWNER/MANAGER.
    if (
      (role === EmployeeRole.OWNER || role === EmployeeRole.MANAGER) &&
      membership.role !== EmployeeRole.OWNER
    ) {
      throw new ForbiddenException('Only OWNER can invite OWNER or MANAGER roles');
    }

    const { token, expiresAt } = await this.inviteTokens.issue({
      companyId,
      role,
      position: dto.position ?? null,
      monthlySalary: dto.monthlySalary ?? null,
      hourlyRate: dto.hourlyRate ?? null,
      invitedByUserId: userId,
    });

    const botUsername = process.env.TELEGRAM_BOT_USERNAME ?? 'worktact_bot';
    const inviteLink = `https://t.me/${botUsername}?start=inv_${token}`;

    return { inviteLink, token, expiresAt };
  }

  /**
   * List all employees of a company. OWNER/MANAGER only (enforced by guard).
   *
   * Returns a UI-friendly shape:
   *   { items: [{ id, name, position, role, status, monthlySalary,
   *               hourlyRate, checkedInToday, lateCountMonth, avatarUrl }] }
   *
   * `checkedInToday` is computed against the company's local timezone; a
   * single IN check-in for today flips it true. `lateCountMonth` counts days
   * this calendar month where the first IN exceeded `workStartHour + grace`.
   * BigInt (`user.telegramId`) is dropped from the payload because Nest's
   * default JSON serializer chokes on it.
   */
  async listEmployees(companyId: string, includeInactive = false) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, timezone: true, workStartHour: true },
    });
    if (!company) throw new NotFoundException('Company not found');

    // Month-to-date window for late counting. Pulled in a single query per
    // employee roster load — this endpoint is not in a hot path.
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const employees = await this.prisma.employee.findMany({
      where: {
        companyId,
        role: { not: EmployeeRole.OWNER },
        ...(includeInactive ? {} : { status: EmployeeStatus.ACTIVE }),
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true,
            avatarUrl: true,
          },
        },
        checkIns: {
          where: { timestamp: { gte: monthStart } },
          select: { type: true, timestamp: true },
        },
        shift: {
          select: { id: true, name: true, startHour: true, endHour: true },
        },
      },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });

    // Today's local YYYY-MM-DD key in the company timezone. We compare
    // check-in day keys against this to derive `checkedInToday`.
    const todayKey = new Intl.DateTimeFormat('en-CA', {
      timeZone: company.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);

    const items = employees.map((emp) => {
      const firstName = emp.user.firstName ?? '';
      const lastName = emp.user.lastName ?? '';
      const name = `${firstName}${lastName ? ` ${lastName}` : ''}`.trim() || 'Без имени';

      const byDay = groupByDay(emp.checkIns, company.timezone);
      let lateCountMonth = 0;
      let checkedInToday = false;

      for (const [dayKey, dayCheckIns] of byDay) {
        const sorted = [...dayCheckIns].sort(
          (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
        );
        const firstIn = sorted.find((c) => c.type === 'IN');
        if (!firstIn) continue;
        if (dayKey === todayKey) checkedInToday = true;
        const { hour, minute } = localParts(firstIn.timestamp, company.timezone);
        const lateMin = computeLateMinutes(
          hour,
          minute,
          company.workStartHour,
          LATE_GRACE_MINUTES,
        );
        if (lateMin > 0) lateCountMonth += 1;
      }

      // Prisma Decimal → number | null so JSON.stringify is happy and the
      // frontend can format with Intl.NumberFormat without a .toString() dance.
      const monthlySalary =
        emp.monthlySalary == null ? null : Number(emp.monthlySalary.toString());
      const hourlyRate = emp.hourlyRate == null ? null : Number(emp.hourlyRate.toString());

      return {
        id: emp.id,
        name,
        position: emp.position,
        role: emp.role,
        status: emp.status,
        monthlySalary,
        hourlyRate,
        checkedInToday,
        lateCountMonth,
        avatarUrl: emp.user.avatarUrl,
        departmentId: emp.departmentId,
        shiftId: emp.shiftId,
        shift: emp.shift
          ? { id: emp.shift.id, name: emp.shift.name, startHour: emp.shift.startHour, endHour: emp.shift.endHour }
          : null,
      };
    });

    return { items };
  }

  /**
   * Rich employee profile: identity, salary, department/shift, plus 30-day
   * arrival history, month-to-date worked-hours / late-count, this-year
   * vacation days, recent check-ins and absences. All local-day arithmetic is
   * done in the company timezone. Decimal -> number; no BigInt in the payload.
   */
  async getEmployeeDetail(companyId: string, employeeId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, timezone: true, workStartHour: true },
    });
    if (!company) throw new NotFoundException('Company not found');

    const now = new Date();
    const yearStartUtc = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    // 30-day window (inclusive of today). Use UTC midnight 29 days back as the
    // lower bound — local-day grouping happens below.
    const windowStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const emp = await this.prisma.employee.findFirst({
      where: { id: employeeId, companyId },
      include: {
        user: {
          select: { firstName: true, lastName: true, avatarUrl: true },
        },
        department: { select: { name: true } },
        shift: { select: { name: true } },
        checkIns: {
          where: { timestamp: { gte: windowStart } },
          select: { type: true, timestamp: true },
          orderBy: { timestamp: 'asc' },
        },
        absences: {
          orderBy: { startDate: 'desc' },
          select: { type: true, startDate: true, endDate: true, note: true },
        },
      },
    });
    if (!emp) throw new NotFoundException('Employee not found');

    const firstName = emp.user.firstName ?? '';
    const lastName = emp.user.lastName ?? '';
    const name = `${firstName}${lastName ? ` ${lastName}` : ''}`.trim() || 'Без имени';

    // Local-day key formatter in the company timezone.
    const dayFmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: company.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });

    const byDay = groupByDay(emp.checkIns, company.timezone);

    // --- 30-day arrival series (oldest -> newest), one slot per local day ---
    const arrivals30d: { date: string; firstInMinutes: number | null }[] = [];
    const arrivalMinutesSamples: number[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const key = dayFmt.format(d);
      const dayCheckIns = byDay.get(key) ?? [];
      const firstIn = [...dayCheckIns]
        .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
        .find((c) => c.type === 'IN');
      if (firstIn) {
        const { hour, minute } = localParts(firstIn.timestamp, company.timezone);
        const mins = hour * 60 + minute;
        arrivals30d.push({ date: key, firstInMinutes: mins });
        arrivalMinutesSamples.push(mins);
      } else {
        arrivals30d.push({ date: key, firstInMinutes: null });
      }
    }
    const avgArrivalMinutes =
      arrivalMinutesSamples.length > 0
        ? Math.round(
            arrivalMinutesSamples.reduce((a, b) => a + b, 0) / arrivalMinutesSamples.length,
          )
        : null;

    // --- Month-to-date late count + worked hours (pair IN/OUT per local day) ---
    let lateCountMonth = 0;
    let workedSecondsMonth = 0;
    const monthKeyPrefix = new Intl.DateTimeFormat('en-CA', {
      timeZone: company.timezone,
      year: 'numeric',
      month: '2-digit',
    }).format(now);
    for (const [dayKey, dayCheckIns] of byDay) {
      // Cheap month filter on the local-day key (YYYY-MM-...).
      if (!dayKey.startsWith(monthKeyPrefix)) continue;
      const sorted = [...dayCheckIns].sort(
        (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
      );
      const firstIn = sorted.find((c) => c.type === 'IN');
      if (firstIn) {
        const { hour, minute } = localParts(firstIn.timestamp, company.timezone);
        if (
          computeLateMinutes(hour, minute, company.workStartHour, LATE_GRACE_MINUTES) > 0
        ) {
          lateCountMonth += 1;
        }
        const lastOut = [...sorted].reverse().find((c) => c.type === 'OUT');
        if (lastOut && lastOut.timestamp.getTime() > firstIn.timestamp.getTime()) {
          workedSecondsMonth += (lastOut.timestamp.getTime() - firstIn.timestamp.getTime()) / 1000;
        }
      }
    }
    const workedHoursMonth = Math.round((workedSecondsMonth / 3600) * 10) / 10;

    // --- This-year vacation days (sum of inclusive day spans of VACATION) ---
    let vacationDaysThisYear = 0;
    for (const a of emp.absences) {
      if (a.type !== 'VACATION') continue;
      if (a.endDate < yearStartUtc) continue;
      const start = a.startDate < yearStartUtc ? yearStartUtc : a.startDate;
      const days =
        Math.floor((a.endDate.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
      vacationDaysThisYear += Math.max(0, days);
    }

    // --- Recent check-ins (last ~20, newest first) ---
    const recentCheckIns = [...emp.checkIns]
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, 20)
      .map((c) => ({ type: c.type, timestamp: c.timestamp }));

    const monthlySalary =
      emp.monthlySalary == null ? null : Number(emp.monthlySalary.toString());
    const hourlyRate = emp.hourlyRate == null ? null : Number(emp.hourlyRate.toString());

    return {
      id: emp.id,
      name,
      position: emp.position,
      role: emp.role,
      status: emp.status,
      avatarUrl: emp.user.avatarUrl,
      monthlySalary,
      hourlyRate,
      departmentName: emp.department?.name ?? null,
      shiftName: emp.shift?.name ?? null,
      stats: {
        avgArrivalMinutes,
        lateCountMonth,
        workedHoursMonth,
        vacationDaysThisYear,
      },
      arrivals30d,
      recentCheckIns,
      absences: emp.absences.map((a) => ({
        type: a.type,
        startDate: a.startDate,
        endDate: a.endDate,
        note: a.note,
      })),
    };
  }

  /**
   * Update an employee's position / rate / role. Role changes require OWNER.
   */
  async updateEmployee(
    actorUserId: string,
    companyId: string,
    employeeId: string,
    patch: {
      position?: string;
      monthlySalary?: number | null;
      hourlyRate?: number | null;
      role?: EmployeeRole;
      status?: EmployeeStatus;
      departmentId?: string | null;
    },
  ) {
    const actor = await this.prisma.employee.findFirst({
      where: { userId: actorUserId, companyId },
    });
    if (!actor) throw new NotFoundException('Company not found');
    if (actor.role !== EmployeeRole.OWNER && actor.role !== EmployeeRole.MANAGER) {
      throw new ForbiddenException('Only OWNER or MANAGER can modify employees');
    }
    if (patch.role && actor.role !== EmployeeRole.OWNER) {
      throw new ForbiddenException('Only OWNER can change an employee role');
    }

    const target = await this.prisma.employee.findFirst({
      where: { id: employeeId, companyId },
    });
    if (!target) throw new NotFoundException('Employee not found');

    // Prevent demoting the sole OWNER.
    if (target.role === EmployeeRole.OWNER && patch.role && patch.role !== EmployeeRole.OWNER) {
      const ownerCount = await this.prisma.employee.count({
        where: { companyId, role: EmployeeRole.OWNER },
      });
      if (ownerCount <= 1) {
        throw new ConflictException('Cannot demote the last OWNER of the company');
      }
    }

    return this.prisma.employee.update({
      where: { id: employeeId },
      data: {
        position: patch.position,
        monthlySalary: patch.monthlySalary ?? undefined,
        hourlyRate: patch.hourlyRate ?? undefined,
        role: patch.role,
        status: patch.status,
        departmentId: patch.departmentId,
      },
    });
  }

  /**
   * Soft-delete an employee by flipping status to INACTIVE. OWNER only.
   */
  async deactivateEmployee(actorUserId: string, companyId: string, employeeId: string) {
    const actor = await this.prisma.employee.findFirst({
      where: { userId: actorUserId, companyId },
    });
    if (!actor) throw new NotFoundException('Company not found');
    if (actor.role !== EmployeeRole.OWNER) {
      throw new ForbiddenException('Only OWNER can deactivate employees');
    }

    const target = await this.prisma.employee.findFirst({
      where: { id: employeeId, companyId },
      include: {
        user: { select: { telegramId: true, firstName: true } },
        company: { select: { name: true } },
      },
    });
    if (!target) throw new NotFoundException('Employee not found');

    if (target.role === EmployeeRole.OWNER) {
      const ownerCount = await this.prisma.employee.count({
        where: { companyId, role: EmployeeRole.OWNER, status: EmployeeStatus.ACTIVE },
      });
      if (ownerCount <= 1) {
        throw new ConflictException('Cannot remove the last active OWNER of the company');
      }
    }

    await this.prisma.employee.update({
      where: { id: employeeId },
      data: { status: EmployeeStatus.INACTIVE },
    });

    await this.audit.record({
      actorUserId: actorUserId,
      companyId,
      action: 'employee.removed',
      targetType: 'Employee',
      targetId: employeeId,
      metadata: { employeeId, firedBy: actorUserId },
    });

    return {
      ok: true,
      fired: {
        telegramId: target.user.telegramId,
        firstName: target.user.firstName,
        companyName: target.company.name,
      },
    };
  }
}
