import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '@/common/prisma.service';
import type { CreateHoliday } from './holiday.dto';

/** Serialised holiday row returned to the client. */
export interface HolidayDto {
  id: string;
  date: string; // YYYY-MM-DD
  name: string;
}

/** Build the [start, endExclusive) UTC range covering a calendar year. */
function yearRangeUtc(year: number): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(year, 0, 1)),
    end: new Date(Date.UTC(year + 1, 0, 1)),
  };
}

/** UTC midnight of a `YYYY-MM-DD` calendar date. */
function dateOnlyUtc(isoDate: string): Date {
  // `new Date('YYYY-MM-DD')` already parses as UTC midnight, but be explicit.
  const [y, m, d] = isoDate.split('-').map((p) => Number(p));
  return new Date(Date.UTC(y, m - 1, d));
}

/** Format a stored Date back to `YYYY-MM-DD` using its UTC parts. */
function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * HolidayService — CRUD for a company's calendar of non-working days.
 *
 * Membership/role enforcement is handled by `CompanyRoleGuard` on the
 * controller, so the service trusts the `companyId` it receives. It still
 * verifies the company exists for clearer 404s.
 */
@Injectable()
export class HolidayService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * List holidays for a company within a given year (defaults to the current
   * year), ordered by date ascending.
   */
  async list(companyId: string, year?: number): Promise<HolidayDto[]> {
    await this.assertCompany(companyId);

    const y =
      year && Number.isFinite(year) ? Math.trunc(year) : new Date().getUTCFullYear();
    const { start, end } = yearRangeUtc(y);

    const rows = await this.prisma.holiday.findMany({
      where: { companyId, date: { gte: start, lt: end } },
      orderBy: { date: 'asc' },
      select: { id: true, date: true, name: true },
    });

    return rows.map((r) => ({ id: r.id, date: toDateString(r.date), name: r.name }));
  }

  /**
   * Create one holiday. Duplicates on `@@unique([companyId, date])` raise 409.
   */
  async create(companyId: string, dto: CreateHoliday): Promise<HolidayDto> {
    await this.assertCompany(companyId);

    const date = dateOnlyUtc(dto.date);
    const existing = await this.prisma.holiday.findUnique({
      where: { companyId_date: { companyId, date } },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('A holiday already exists for that date');
    }

    const created = await this.prisma.holiday.create({
      data: { companyId, date, name: dto.name },
      select: { id: true, date: true, name: true },
    });
    return { id: created.id, date: toDateString(created.date), name: created.name };
  }

  /** Delete a holiday by id (scoped to the company). */
  async remove(companyId: string, holidayId: string): Promise<{ ok: true; deletedId: string }> {
    const found = await this.prisma.holiday.findFirst({
      where: { id: holidayId, companyId },
      select: { id: true },
    });
    if (!found) throw new NotFoundException('Holiday not found');

    await this.prisma.holiday.delete({ where: { id: holidayId } });
    return { ok: true, deletedId: holidayId };
  }

  private async assertCompany(companyId: string): Promise<void> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true },
    });
    if (!company) throw new NotFoundException('Company not found');
  }
}
