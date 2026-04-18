import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CheckInType, EmployeeRole } from '@prisma/client';
import { endOfMonth, startOfDay, startOfMonth } from 'date-fns';

import { PrismaService } from '@/common/prisma.service';
import type { CheckInResponse } from '@tact/types';
import type { ScanQrDto } from './dto/scan-qr.dto';
import type { ManualCheckinDto } from './dto/manual-checkin.dto';
import { QrService } from './qr.service';

/**
 * Geofence slack, in metres. Added on top of Company.geofenceRadiusM to
 * forgive GPS jitter in urban canyons without forcing offices to over-size
 * their configured radius.
 */
const GEOFENCE_BUFFER_M = 50;

/** Haversine distance in metres between two lat/lng points. */
function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

@Injectable()
export class CheckinService {
  private readonly logger = new Logger(CheckinService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly qr: QrService,
  ) {}

  // ---------------------------------------------------------------------------
  // QR scan flow
  // ---------------------------------------------------------------------------

  async scan(userId: string, dto: ScanQrDto): Promise<CheckInResponse> {
    // 1. Verify token signature + DB row (independent of employee).
    const { companyId, tokenId } = await this.qr.verify(dto.token);

    // 2. Confirm the scanning user is an employee at that company.
    const employee = await this.prisma.employee.findUnique({
      where: { userId_companyId: { userId, companyId } },
    });
    if (!employee) {
      throw new ForbiddenException('You are not an employee of this company');
    }
    if (employee.status !== 'ACTIVE') {
      throw new ForbiddenException('Your employment is not active');
    }

    // 3. Re-verify with employeeId so the same employee cannot reuse this token.
    await this.qr.verify(dto.token, employee.id);

    // 4. Decide direction: if the last event today was an un-paired IN, OUT;
    //    otherwise IN.
    const type = await this.nextTypeFor(employee.id);

    // 5. Optional geofence — only enforced when both sides have coordinates.
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: {
        latitude: true,
        longitude: true,
        geofenceRadiusM: true,
        workStartHour: true,
      },
    });
    if (!company) {
      // Should be impossible because verify() already found the token row.
      throw new NotFoundException('Company not found');
    }

    if (
      company.latitude != null &&
      company.longitude != null &&
      dto.latitude != null &&
      dto.longitude != null
    ) {
      const distance = haversineMeters(
        company.latitude,
        company.longitude,
        dto.latitude,
        dto.longitude,
      );
      const allowed = company.geofenceRadiusM + GEOFENCE_BUFFER_M;
      if (distance > allowed) {
        this.logger.warn(
          `Geofence reject employee=${employee.id} distance=${Math.round(
            distance,
          )}m allowed=${allowed}m`,
        );
        throw new ForbiddenException(
          'You are outside the office geofence. Move closer and scan again.',
        );
      }
    }

    // 6. Persist the CheckIn and mark token consumed.
    const now = new Date();
    const checkIn = await this.prisma.checkIn.create({
      data: {
        employeeId: employee.id,
        type,
        timestamp: now,
        latitude: dto.latitude ?? null,
        longitude: dto.longitude ?? null,
        tokenId,
      },
    });
    await this.qr.consume(dto.token, employee.id);

    const isLate = type === CheckInType.IN ? this.isLate(now, company.workStartHour) : false;
    const lateMinutes =
      type === CheckInType.IN ? this.lateMinutes(now, company.workStartHour) : null;

    this.logger.log(`CheckIn created employee=${employee.id} type=${type} late=${isLate}`);

    return {
      id: checkIn.id,
      type,
      timestamp: checkIn.timestamp.toISOString(),
      isLate,
      lateMinutes,
    };
  }

  // ---------------------------------------------------------------------------
  // History
  // ---------------------------------------------------------------------------

  /**
   * Check-ins for the calling user in the given company for the current month,
   * oldest-first so the UI can render a timeline without re-sorting.
   */
  async listMyMonth(userId: string, companyId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { userId_companyId: { userId, companyId } },
      select: { id: true },
    });
    if (!employee) {
      throw new ForbiddenException('You are not an employee of this company');
    }

    const now = new Date();
    const from = startOfMonth(now);
    const to = endOfMonth(now);

    const rows = await this.prisma.checkIn.findMany({
      where: {
        employeeId: employee.id,
        timestamp: { gte: from, lte: to },
      },
      orderBy: { timestamp: 'asc' },
      select: {
        id: true,
        type: true,
        timestamp: true,
        latitude: true,
        longitude: true,
      },
    });

    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      timestamp: r.timestamp.toISOString(),
      latitude: r.latitude,
      longitude: r.longitude,
    }));
  }

  // ---------------------------------------------------------------------------
  // Manual admin creation
  // ---------------------------------------------------------------------------

  /**
   * OWNER/MANAGER creates a CheckIn on behalf of an employee — e.g. to patch
   * a missed scan when the office screen was down. The current schema has no
   * column for an audit `reason`, so MVP logs it at WARN level for operations
   * traceability until a dedicated audit table exists.
   */
  async manualCreate(
    actorUserId: string,
    actorRole: EmployeeRole,
    dto: ManualCheckinDto,
  ): Promise<CheckInResponse> {
    if (actorRole !== EmployeeRole.OWNER && actorRole !== EmployeeRole.MANAGER) {
      throw new ForbiddenException('Only OWNER or MANAGER can create manual check-ins');
    }

    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
      select: {
        id: true,
        companyId: true,
        company: { select: { workStartHour: true } },
      },
    });
    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    // Actor must share a company with the target employee.
    const actorEmployee = await this.prisma.employee.findUnique({
      where: {
        userId_companyId: {
          userId: actorUserId,
          companyId: employee.companyId,
        },
      },
      select: { role: true },
    });
    if (
      !actorEmployee ||
      (actorEmployee.role !== EmployeeRole.OWNER && actorEmployee.role !== EmployeeRole.MANAGER)
    ) {
      throw new ForbiddenException("You must be OWNER or MANAGER of this employee's company");
    }

    const timestamp = dto.timestamp ? new Date(dto.timestamp) : new Date();
    if (Number.isNaN(timestamp.getTime())) {
      throw new BadRequestException('Invalid timestamp');
    }

    const checkIn = await this.prisma.checkIn.create({
      data: {
        employeeId: employee.id,
        type: dto.type as CheckInType,
        timestamp,
      },
    });

    if (dto.reason) {
      // TODO: persist to a dedicated audit table once the schema has one.
      this.logger.warn(
        `Manual check-in actor=${actorUserId} employee=${employee.id} type=${dto.type} reason=${JSON.stringify(dto.reason)}`,
      );
    }

    const type = dto.type as CheckInType;
    const isLate =
      type === CheckInType.IN ? this.isLate(timestamp, employee.company.workStartHour) : false;
    const lateMinutes =
      type === CheckInType.IN ? this.lateMinutes(timestamp, employee.company.workStartHour) : null;

    return {
      id: checkIn.id,
      type,
      timestamp: checkIn.timestamp.toISOString(),
      isLate,
      lateMinutes,
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Determine whether the next CheckIn for this employee today should be IN
   * or OUT. If the most recent event today was an IN with no OUT after it,
   * the next is OUT; otherwise IN. This matches the pairing logic used by
   * the employee stats service.
   */
  private async nextTypeFor(employeeId: string): Promise<CheckInType> {
    const dayStart = startOfDay(new Date());
    const last = await this.prisma.checkIn.findFirst({
      where: { employeeId, timestamp: { gte: dayStart } },
      orderBy: { timestamp: 'desc' },
      select: { type: true },
    });
    if (last && last.type === CheckInType.IN) return CheckInType.OUT;
    return CheckInType.IN;
  }

  /**
   * Company-clock late comparison. Uses the server-local day with a fixed
   * +3h offset (Europe/Moscow) to stay consistent with EmployeeService —
   * no tz library is pulled in for a single supported zone.
   */
  private isLate(timestamp: Date, workStartHour: number): boolean {
    return this.lateMinutes(timestamp, workStartHour) > 0;
  }

  private lateMinutes(timestamp: Date, workStartHour: number): number {
    const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
    const msk = new Date(timestamp.getTime() + MSK_OFFSET_MS);
    const minuteOfDay = msk.getUTCHours() * 60 + msk.getUTCMinutes();
    const startMinute = workStartHour * 60;
    return Math.max(0, minuteOfDay - startMinute);
  }
}
