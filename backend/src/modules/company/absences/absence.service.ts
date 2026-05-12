import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AbsenceStatus, AbsenceType, EmployeeRole } from '@prisma/client';
import { PrismaService } from '@/common/prisma.service';
import { BotService } from '@/modules/telegram/bot.service';
import type { CreateAbsenceDto } from './absence.dto';

const ABSENCE_MESSAGES: Record<AbsenceType, (name: string, start: string, end: string) => string> = {
  VACATION: (n, s, e) => `🏖 Приятного отдыха, ${n}! Отпуск утверждён: ${s} – ${e}.`,
  SICK_LEAVE: (n, s, e) => `🤒 Выздоравливайте, ${n}! Больничный утверждён: ${s} – ${e}.`,
  DAY_OFF: (n, s, e) => `😌 Хорошего отдыха, ${n}! Выходной утверждён: ${s === e ? s : `${s} – ${e}`}.`,
  BUSINESS_TRIP: (n, s, e) => `✈️ Удачной командировки, ${n}! ${s} – ${e}.`,
};

const APPROVER_ROLES: EmployeeRole[] = [
  EmployeeRole.OWNER,
  EmployeeRole.MANAGER,
  EmployeeRole.HR,
];

function fmtDate(iso: string | Date): string {
  const d = new Date(iso);
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
}

@Injectable()
export class AbsenceService {
  private readonly logger = new Logger(AbsenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bot: BotService,
  ) {}

  /**
   * List all absences for a company, optionally filtered to a calendar month
   * and/or a status.
   *
   * @param companyId  The company whose absences to list.
   * @param month      Optional "YYYY-MM" string; when provided, only absences
   *                   that overlap the calendar month are returned.
   * @param status     Optional AbsenceStatus filter (PENDING/APPROVED/REJECTED).
   */
  async list(companyId: string, month?: string, status?: AbsenceStatus) {
    // Build an optional date-range filter that catches any absence whose
    // [startDate, endDate] interval overlaps the requested month.
    let dateFilter: { startDate?: object; endDate?: object } = {};

    if (month) {
      const [y, m] = month.split('-').map(Number);
      const monthStart = new Date(y, m - 1, 1);
      const monthEnd = new Date(y, m, 1); // exclusive

      // Overlap condition: absence.startDate < monthEnd AND absence.endDate >= monthStart
      dateFilter = {
        startDate: { lt: monthEnd },
        endDate: { gte: monthStart },
      };
    }

    const absences = await this.prisma.absence.findMany({
      where: {
        employee: { companyId },
        ...dateFilter,
        ...(status ? { status } : {}),
      },
      include: {
        employee: {
          include: {
            user: {
              select: { firstName: true, lastName: true, username: true },
            },
          },
        },
      },
      orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
    });

    return absences.map((a) => ({
      id: a.id,
      employeeId: a.employeeId,
      employeeName: [a.employee.user.firstName, a.employee.user.lastName]
        .filter(Boolean)
        .join(' ')
        .trim() || a.employee.user.username || a.employeeId,
      type: a.type,
      status: a.status,
      startDate: a.startDate.toISOString(),
      endDate: a.endDate.toISOString(),
      note: a.note ?? null,
      approvedById: a.approvedById ?? null,
      createdAt: a.createdAt.toISOString(),
    }));
  }

  /**
   * Create a new absence record (manager-initiated, via REST).
   * Only OWNER or MANAGER employees of the company may call this.
   * The absence is APPROVED immediately (schema default).
   */
  async create(userId: string, companyId: string, dto: CreateAbsenceDto) {
    await this.requireOwnerOrManager(userId, companyId);

    // Verify the target employee belongs to this company.
    const employee = await this.prisma.employee.findFirst({
      where: { id: dto.employeeId, companyId },
      include: { user: { select: { telegramId: true, firstName: true } } },
    });
    if (!employee) {
      throw new NotFoundException('Employee not found in this company');
    }

    const absence = await this.prisma.absence.create({
      data: {
        employeeId: dto.employeeId,
        type: dto.type,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        note: dto.note ?? null,
        approvedById: userId,
        // status defaults to APPROVED in the schema
      },
    });

    // Fire-and-forget Telegram notification to the employee
    const name = employee.user.firstName;
    const msg = ABSENCE_MESSAGES[dto.type](name, fmtDate(dto.startDate), fmtDate(dto.endDate));
    this.bot.notifyUser(employee.user.telegramId, msg).catch((e) =>
      this.logger.warn(`absence notify failed: ${(e as Error).message}`),
    );

    return { id: absence.id, ...dto, status: absence.status, createdAt: absence.createdAt.toISOString() };
  }

  /**
   * Approve a PENDING absence request. OWNER/MANAGER/HR only.
   */
  async approve(userId: string, companyId: string, absenceId: string) {
    return this.decide(userId, companyId, absenceId, AbsenceStatus.APPROVED);
  }

  /**
   * Reject a PENDING absence request. OWNER/MANAGER/HR only.
   */
  async reject(userId: string, companyId: string, absenceId: string) {
    return this.decide(userId, companyId, absenceId, AbsenceStatus.REJECTED);
  }

  private async decide(
    userId: string,
    companyId: string,
    absenceId: string,
    status: AbsenceStatus,
  ) {
    await this.requireApprover(userId, companyId);

    const absence = await this.prisma.absence.findFirst({
      where: { id: absenceId, employee: { companyId } },
      include: { employee: { include: { user: { select: { telegramId: true, firstName: true } } } } },
    });
    if (!absence) {
      throw new NotFoundException('Absence record not found');
    }

    const updated = await this.prisma.absence.update({
      where: { id: absenceId },
      data: { status, approvedById: userId },
    });

    const name = absence.employee.user.firstName;
    const start = fmtDate(absence.startDate);
    const end = fmtDate(absence.endDate);
    const msg =
      status === AbsenceStatus.APPROVED
        ? ABSENCE_MESSAGES[absence.type](name, start, end)
        : `❌ ${name}, ваша заявка отклонена: ${start} – ${end}.`;
    this.bot.notifyUser(absence.employee.user.telegramId, msg).catch((e) =>
      this.logger.warn(`absence decision notify failed: ${(e as Error).message}`),
    );

    return {
      id: updated.id,
      status: updated.status,
      approvedById: updated.approvedById ?? null,
    };
  }

  /**
   * Delete an absence by ID.
   * Only OWNER or MANAGER employees of the company may call this.
   */
  async remove(userId: string, companyId: string, id: string) {
    await this.requireOwnerOrManager(userId, companyId);

    const absence = await this.prisma.absence.findFirst({
      where: { id, employee: { companyId } },
    });
    if (!absence) {
      throw new NotFoundException('Absence record not found');
    }

    await this.prisma.absence.delete({ where: { id } });
    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async requireOwnerOrManager(userId: string, companyId: string) {
    const emp = await this.prisma.employee.findFirst({
      where: { userId, companyId },
    });
    if (!emp) {
      throw new ForbiddenException('You are not a member of this company');
    }
    if (emp.role !== EmployeeRole.OWNER && emp.role !== EmployeeRole.MANAGER) {
      throw new ForbiddenException('OWNER or MANAGER role required');
    }
    return emp;
  }

  private async requireApprover(userId: string, companyId: string) {
    const emp = await this.prisma.employee.findFirst({
      where: { userId, companyId },
    });
    if (!emp) {
      throw new ForbiddenException('You are not a member of this company');
    }
    if (!APPROVER_ROLES.includes(emp.role)) {
      throw new ForbiddenException('OWNER, MANAGER or HR role required');
    }
    return emp;
  }
}
