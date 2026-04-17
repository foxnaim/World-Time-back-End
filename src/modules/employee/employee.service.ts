import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CheckInType, EmployeeRole } from '@prisma/client';
import { startOfDay, startOfMonth } from 'date-fns';

import { PrismaService } from '@/common/prisma.service';

type SerializedEmployee = {
  id: string;
  company: { id: string; name: string; slug: string };
  role: EmployeeRole;
  position: string | null;
  monthlySalary: string | null;
  hourlyRate: string | null;
  status: string;
};

type EmployeeWithStats = SerializedEmployee & {
  todayCheckedIn: boolean;
  currentMonthWorkedHours: number;
  lateCountThisMonth: number;
};

@Injectable()
export class EmployeeService {
  private readonly logger = new Logger(EmployeeService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Return every Employee record belonging to the given user, one per company.
   */
  async myEmployees(userId: string): Promise<SerializedEmployee[]> {
    const rows = await this.prisma.employee.findMany({
      where: { userId },
      include: {
        company: { select: { id: true, name: true, slug: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return rows.map((row) => this.serializeEmployee(row));
  }

  /**
   * Return the user's Employee record in the given company, enriched with
   * derived stats (todayCheckedIn, currentMonthWorkedHours, lateCountThisMonth).
   */
  async getMyEmployee(
    userId: string,
    companyId: string,
  ): Promise<EmployeeWithStats> {
    const employee = await this.prisma.employee.findUnique({
      where: { userId_companyId: { userId, companyId } },
      include: {
        company: {
          select: {
            id: true,
            name: true,
            slug: true,
            workStartHour: true,
            timezone: true,
          },
        },
      },
    });

    if (!employee) {
      throw new NotFoundException('Employee record not found for this company');
    }

    const stats = await this.computeStats(
      employee.id,
      employee.company.workStartHour,
    );

    return {
      ...this.serializeEmployee(employee),
      ...stats,
    };
  }

  /**
   * Admin (OWNER/MANAGER) read of another employee in the same company.
   */
  async adminGet(
    employeeId: string,
    viewerUserId: string,
  ): Promise<EmployeeWithStats> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      include: {
        company: {
          select: {
            id: true,
            name: true,
            slug: true,
            workStartHour: true,
            timezone: true,
          },
        },
      },
    });

    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    const viewer = await this.prisma.employee.findUnique({
      where: {
        userId_companyId: {
          userId: viewerUserId,
          companyId: employee.companyId,
        },
      },
      select: { role: true },
    });

    if (
      !viewer ||
      (viewer.role !== EmployeeRole.OWNER && viewer.role !== EmployeeRole.MANAGER)
    ) {
      throw new ForbiddenException(
        'Only OWNER or MANAGER can view other employees',
      );
    }

    const stats = await this.computeStats(
      employee.id,
      employee.company.workStartHour,
    );

    return {
      ...this.serializeEmployee(employee),
      ...stats,
    };
  }

  /**
   * Create an Employee row. Used by accept-invite. Idempotent-ish: if the row
   * already exists we return it without throwing, so re-accepting a stale
   * token after the token has been consumed does not leave the user stranded.
   */
  async createFromInvite(params: {
    userId: string;
    companyId: string;
    role: EmployeeRole;
    position?: string | null;
    monthlySalary?: string | number | null;
    hourlyRate?: string | number | null;
  }) {
    const existing = await this.prisma.employee.findUnique({
      where: {
        userId_companyId: {
          userId: params.userId,
          companyId: params.companyId,
        },
      },
    });
    if (existing) {
      this.logger.log(
        `accept-invite: employee already exists userId=${params.userId} companyId=${params.companyId}`,
      );
      return existing;
    }

    return this.prisma.employee.create({
      data: {
        userId: params.userId,
        companyId: params.companyId,
        role: params.role,
        position: params.position ?? null,
        monthlySalary:
          params.monthlySalary !== undefined && params.monthlySalary !== null
            ? (params.monthlySalary as unknown as never)
            : null,
        hourlyRate:
          params.hourlyRate !== undefined && params.hourlyRate !== null
            ? (params.hourlyRate as unknown as never)
            : null,
      },
    });
  }

  // ----- internals -----

  private serializeEmployee(employee: {
    id: string;
    role: EmployeeRole;
    position: string | null;
    monthlySalary: { toString: () => string } | null;
    hourlyRate: { toString: () => string } | null;
    status: string;
    company: { id: string; name: string; slug: string };
  }): SerializedEmployee {
    return {
      id: employee.id,
      company: {
        id: employee.company.id,
        name: employee.company.name,
        slug: employee.company.slug,
      },
      role: employee.role,
      position: employee.position ?? null,
      monthlySalary:
        employee.monthlySalary !== null && employee.monthlySalary !== undefined
          ? employee.monthlySalary.toString()
          : null,
      hourlyRate:
        employee.hourlyRate !== null && employee.hourlyRate !== undefined
          ? employee.hourlyRate.toString()
          : null,
      status: employee.status,
    };
  }

  private async computeStats(
    employeeId: string,
    workStartHour: number,
  ): Promise<{
    todayCheckedIn: boolean;
    currentMonthWorkedHours: number;
    lateCountThisMonth: number;
  }> {
    const now = new Date();
    const monthStart = startOfMonth(now);
    const dayStart = startOfDay(now);

    // Today: has the employee checked IN since start of local day?
    // MVP treats the server's local day as the company day. Good enough for
    // Europe/Moscow deployments, which is our default.
    const todayIn = await this.prisma.checkIn.findFirst({
      where: {
        employeeId,
        type: CheckInType.IN,
        timestamp: { gte: dayStart },
      },
      select: { id: true },
    });

    // All check-ins this month, ordered, so we can pair IN/OUT for hours and
    // count lateness on IN events.
    const monthCheckIns = await this.prisma.checkIn.findMany({
      where: {
        employeeId,
        timestamp: { gte: monthStart },
      },
      orderBy: { timestamp: 'asc' },
      select: { type: true, timestamp: true },
    });

    let workedMs = 0;
    let pendingIn: Date | null = null;
    let lateCount = 0;

    for (const ci of monthCheckIns) {
      if (ci.type === CheckInType.IN) {
        if (this.isLate(ci.timestamp, workStartHour)) {
          lateCount += 1;
        }
        pendingIn = ci.timestamp;
      } else if (ci.type === CheckInType.OUT && pendingIn) {
        workedMs += ci.timestamp.getTime() - pendingIn.getTime();
        pendingIn = null;
      }
    }

    // Round to 0.01h for display friendliness.
    const currentMonthWorkedHours =
      Math.round((workedMs / (1000 * 60 * 60)) * 100) / 100;

    return {
      todayCheckedIn: Boolean(todayIn),
      currentMonthWorkedHours,
      lateCountThisMonth: lateCount,
    };
  }

  /**
   * Decide if a check-in is "late" relative to the company's configured
   * start hour. MVP uses Europe/Moscow (UTC+3, no DST), implemented by
   * adding 3h to the UTC timestamp and reading hour/minute from that.
   * Avoids pulling in a tz library for a single supported zone.
   */
  private isLate(timestamp: Date, workStartHour: number): boolean {
    const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
    const mskDate = new Date(timestamp.getTime() + MSK_OFFSET_MS);
    const hour = mskDate.getUTCHours();
    const minute = mskDate.getUTCMinutes();
    if (hour > workStartHour) return true;
    if (hour === workStartHour && minute > 0) return true;
    return false;
  }
}
