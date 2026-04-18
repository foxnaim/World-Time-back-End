import { Injectable, NotFoundException } from '@nestjs/common';
import { EmployeeStatus, Prisma } from '@prisma/client';
import { PrismaService } from '@/common/prisma.service';

export interface ListCompaniesParams {
  limit?: number;
  cursor?: string;
  q?: string;
}

export interface ListUsersParams {
  telegramId?: string;
  phone?: string;
}

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 25;

function clampLimit(n: number | undefined): number {
  if (!n || !Number.isFinite(n) || n <= 0) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.floor(n), MAX_PAGE_SIZE);
}

/**
 * Platform-wide operator service. Used by the super-admin console — has
 * cross-company visibility. Access is gated at the controller level via
 * SuperAdminGuard, so service methods themselves do no access checks.
 */
@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  /** Global platform counters for the admin dashboard. */
  async stats(): Promise<{
    users: number;
    companies: number;
    employees: number;
    activeEmployees: number;
    checkinsToday: number;
    activeProjects: number;
  }> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [users, companies, employees, activeEmployees, checkinsToday, activeProjects] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.company.count(),
        this.prisma.employee.count(),
        this.prisma.employee.count({
          where: { status: EmployeeStatus.ACTIVE },
        }),
        this.prisma.checkIn.count({
          where: { timestamp: { gte: startOfDay } },
        }),
        this.prisma.project.count({ where: { status: 'ACTIVE' } }),
      ]);

    return {
      users,
      companies,
      employees,
      activeEmployees,
      checkinsToday,
      activeProjects,
    };
  }

  /**
   * Cursor-paginated list of companies. Cursor is a company id; results are
   * ordered by createdAt desc, id desc (stable).
   */
  async listCompanies(params: ListCompaniesParams): Promise<{
    items: Array<{
      id: string;
      name: string;
      slug: string;
      ownerId: string;
      createdAt: Date;
      employeeCount: number;
    }>;
    nextCursor: string | null;
  }> {
    const take = clampLimit(params.limit);
    const where: Prisma.CompanyWhereInput = {};
    if (params.q && params.q.trim().length > 0) {
      const q = params.q.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { slug: { contains: q, mode: 'insensitive' } },
      ];
    }

    const rows = await this.prisma.company.findMany({
      where,
      take: take + 1,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        name: true,
        slug: true,
        ownerId: true,
        createdAt: true,
        _count: { select: { employees: true } },
      },
    });

    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    const nextCursor = hasMore ? page[page.length - 1].id : null;

    return {
      items: page.map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        ownerId: c.ownerId,
        createdAt: c.createdAt,
        employeeCount: c._count.employees,
      })),
      nextCursor,
    };
  }

  /** Full details for a single company, including owner and employee roll-up. */
  async companyDetails(id: string) {
    const company = await this.prisma.company.findUnique({
      where: { id },
      include: {
        owner: {
          select: {
            id: true,
            telegramId: true,
            firstName: true,
            lastName: true,
            username: true,
            phone: true,
          },
        },
        _count: {
          select: {
            employees: true,
            qrTokens: true,
            inviteTokens: true,
          },
        },
        employees: {
          select: {
            id: true,
            role: true,
            status: true,
            position: true,
            createdAt: true,
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
          take: 100,
        },
      },
    });

    if (!company) throw new NotFoundException('Company not found');

    // Serialize BigInt telegramId to string for JSON safety.
    return {
      ...company,
      owner: {
        ...company.owner,
        telegramId: company.owner.telegramId.toString(),
      },
      employees: company.employees.map((e) => ({
        ...e,
        user: {
          ...e.user,
          telegramId: e.user.telegramId.toString(),
        },
      })),
    };
  }

  /** Look up users by telegramId or phone. Both optional; returns up to 50. */
  async listUsers(params: ListUsersParams) {
    const where: Prisma.UserWhereInput = {};
    if (params.telegramId) {
      try {
        where.telegramId = BigInt(params.telegramId);
      } catch {
        return { items: [] };
      }
    }
    if (params.phone) {
      where.phone = { contains: params.phone };
    }

    const rows = await this.prisma.user.findMany({
      where,
      take: 50,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        telegramId: true,
        phone: true,
        firstName: true,
        lastName: true,
        username: true,
        createdAt: true,
        _count: {
          select: { employees: true, ownedCompanies: true, projects: true },
        },
      },
    });

    return {
      items: rows.map((u) => ({
        ...u,
        telegramId: u.telegramId.toString(),
        employeeCount: u._count.employees,
        ownedCompanyCount: u._count.ownedCompanies,
        projectCount: u._count.projects,
      })),
    };
  }

  /**
   * "Deactivate" a company. The Company model has no status column (yet), so
   * we implement a soft-close by flipping every employee to INACTIVE — the
   * company becomes functionally unusable. Returns the updated counts.
   */
  async deactivateCompany(id: string) {
    const company = await this.prisma.company.findUnique({
      where: { id },
      select: { id: true, name: true, slug: true },
    });
    if (!company) throw new NotFoundException('Company not found');

    const result = await this.prisma.employee.updateMany({
      where: { companyId: id, status: EmployeeStatus.ACTIVE },
      data: { status: EmployeeStatus.INACTIVE },
    });

    return {
      companyId: company.id,
      name: company.name,
      slug: company.slug,
      deactivatedEmployees: result.count,
    };
  }
}
