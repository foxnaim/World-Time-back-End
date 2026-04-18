import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EmployeeRole, EmployeeStatus, Prisma } from '@prisma/client';
import { createId } from '@paralleldrive/cuid2';
import { PrismaService } from '@/common/prisma.service';
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
   */
  async listEmployees(companyId: string) {
    return this.prisma.employee.findMany({
      where: { companyId },
      include: {
        user: {
          select: {
            id: true,
            telegramId: true,
            firstName: true,
            lastName: true,
            username: true,
          },
        },
      },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });
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
