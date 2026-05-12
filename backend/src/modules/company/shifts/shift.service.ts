import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EmployeeRole } from '@prisma/client';
import { PrismaService } from '@/common/prisma.service';
import { CompanyService } from '../company.service';
import type { CreateShiftDto } from './shift.dto';
import type { UpdateShiftDto } from './shift.dto';

@Injectable()
export class ShiftService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyService: CompanyService,
  ) {}

  /**
   * List all shifts for a company, annotated with the number of employees
   * currently assigned to each one.
   */
  async list(companyId: string) {
    const shifts = await this.prisma.shift.findMany({
      where: { companyId },
      include: { _count: { select: { employees: true } } },
      orderBy: { createdAt: 'asc' },
    });

    return shifts.map((s) => ({
      id: s.id,
      name: s.name,
      startHour: s.startHour,
      endHour: s.endHour,
      employeeCount: s._count.employees,
      createdAt: s.createdAt,
    }));
  }

  /**
   * Create a new shift. Caller must be OWNER or MANAGER.
   */
  async create(userId: string, companyId: string, dto: CreateShiftDto) {
    await this.assertOwnerOrManager(userId, companyId);

    return this.prisma.shift.create({
      data: {
        name: dto.name,
        startHour: dto.startHour,
        endHour: dto.endHour,
        companyId,
      },
      select: { id: true, name: true, startHour: true, endHour: true, companyId: true, createdAt: true },
    });
  }

  /**
   * Update a shift. Caller must be OWNER or MANAGER.
   */
  async update(userId: string, companyId: string, id: string, dto: UpdateShiftDto) {
    await this.assertOwnerOrManager(userId, companyId);
    await this.findOrThrow(id, companyId);

    return this.prisma.shift.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.startHour !== undefined && { startHour: dto.startHour }),
        ...(dto.endHour !== undefined && { endHour: dto.endHour }),
      },
      select: { id: true, name: true, startHour: true, endHour: true, companyId: true, createdAt: true },
    });
  }

  /**
   * Delete a shift and nullify shiftId on all assigned employees.
   */
  async remove(userId: string, companyId: string, id: string) {
    await this.assertOwnerOrManager(userId, companyId);
    await this.findOrThrow(id, companyId);

    await this.prisma.$transaction(async (tx) => {
      // Clear shift assignment from employees before deleting.
      await tx.employee.updateMany({
        where: { companyId, shiftId: id },
        data: { shiftId: null },
      });
      await tx.shift.delete({ where: { id } });
    });

    return { ok: true, deletedId: id };
  }

  /**
   * Assign an employee to a shift. Caller must be OWNER or MANAGER.
   * Passing the same shiftId the employee already has is a no-op.
   */
  async assignEmployee(
    userId: string,
    companyId: string,
    shiftId: string,
    employeeId: string,
  ) {
    await this.assertOwnerOrManager(userId, companyId);
    await this.findOrThrow(shiftId, companyId);

    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, companyId },
      include: { user: { select: { telegramId: true } } },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    const updated = await this.prisma.employee.update({
      where: { id: employeeId },
      data: { shiftId },
      select: { id: true, shiftId: true },
    });

    if (employee.user.telegramId && employee.shiftId !== shiftId) {
      void this.companyService.notifyShiftChange(
        employee.user.telegramId,
        employee.shiftId,
        shiftId,
        companyId,
      );
    }

    return { ok: true, employeeId: updated.id, shiftId: updated.shiftId };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async assertOwnerOrManager(userId: string, companyId: string) {
    const membership = await this.prisma.employee.findFirst({
      where: { userId, companyId },
    });
    if (!membership) {
      throw new NotFoundException('Company not found or you are not a member');
    }
    if (membership.role !== EmployeeRole.OWNER && membership.role !== EmployeeRole.MANAGER) {
      throw new ForbiddenException('Only OWNER or MANAGER can manage shifts');
    }
  }

  private async findOrThrow(id: string, companyId: string) {
    const shift = await this.prisma.shift.findFirst({ where: { id, companyId } });
    if (!shift) throw new NotFoundException('Shift not found');
    return shift;
  }
}
