import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EmployeeRole, EmployeeStatus, Prisma } from '@prisma/client';
import { createId } from '@paralleldrive/cuid2';
import { PrismaService } from '@/common/prisma.service';
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
  async listEmployees(companyId: string) {
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
      where: { companyId },
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
      };
    });

    return { items };
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
    });
    if (!target) throw new NotFoundException('Employee not found');

    if (target.role === EmployeeRole.OWNER) {
      const ownerCount = await this.prisma.employee.count({
        where: {
          companyId,
          role: EmployeeRole.OWNER,
          status: EmployeeStatus.ACTIVE,
        },
      });
      if (ownerCount <= 1) {
        throw new ConflictException('Cannot deactivate the last active OWNER of the company');
      }
    }

    return this.prisma.employee.update({
      where: { id: employeeId },
      data: { status: EmployeeStatus.INACTIVE },
    });
  }
}
