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
import { BotService } from '../telegram/bot.service';

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
    private readonly bot: BotService,
  ) {}

  // ---------------------------------------------------------------------------
  // QR scan flow
  // ---------------------------------------------------------------------------

  async scan(userId: string, dto: ScanQrDto): Promise<CheckInResponse> {
    // 1. Verify token signature + DB row (independent of employee).
    const { companyId } = await this.qr.verify(dto.token);

    // 2. Confirm the scanning user is an employee at that company.
    const employee = await this.prisma.employee.findUnique({
      where: { userId_companyId: { userId, companyId } },
      include: { user: { select: { firstName: true, lastName: true } } },
    });
    if (!employee) {
      throw new ForbiddenException('You are not an employee of this company');
    }
    if (employee.status !== 'ACTIVE') {
      throw new ForbiddenException('Your employment is not active');
    }

    // 3. Load company config for geofence + late calc before the tx so the
    //    transaction stays short.
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: {
        name: true,
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

    // 4. Geofence — enforced whenever the company has coordinates. A scan
    //    without coordinates is refused rather than waved through: otherwise
    //    a QR photo forwarded to someone off-site checks them in.
    if (
      company.latitude != null &&
      company.longitude != null &&
      (dto.latitude == null || dto.longitude == null)
    ) {
      throw new BadRequestException(
        'Location is required to check in at this office. Share your location and scan again.',
      );
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

    // 5. Decide direction: if the last event today was an un-paired IN, OUT;
    //    otherwise IN.
    const type = await this.nextTypeFor(employee.id);

    // 6. Re-verify with employeeId, mark the QR row consumed, and persist the
    //    CheckIn in a single transaction. Without this wrapper two parallel
    //    scans with the same token + employee can both pass the verify step
    //    before either one writes the `usedByEmployeeId` guard.
    const now = new Date();
    const checkIn = await this.prisma.$transaction(async (tx) => {
      const { tokenId } = await this.qr.verify(dto.token, employee.id);
      // Atomic single-winner consume: updateMany with the "not yet used by
      // this employee" guard. Zero affected rows means a concurrent scan
      // beat us to it — mirror the message surfaced by QrService.verify.
      const consumed = await tx.qRToken.updateMany({
        where: { token: dto.token, usedByEmployeeId: null },
        data: { usedByEmployeeId: employee.id, usedAt: now },
      });
      if (consumed.count === 0) {
        throw new ForbiddenException(
          'This QR has already been used for your check-in; wait for the next rotation',
        );
      }
      return tx.checkIn.create({
        data: {
          employeeId: employee.id,
          type,
          timestamp: now,
          latitude: dto.latitude ?? null,
          longitude: dto.longitude ?? null,
          tokenId,
        },
      });
    });

    const isLate = type === CheckInType.IN ? this.isLate(now, company.workStartHour) : false;
    const lateMinutes =
      type === CheckInType.IN ? this.lateMinutes(now, company.workStartHour) : null;

    this.logger.log(`CheckIn created employee=${employee.id} type=${type} late=${isLate}`);

    if (isLate && lateMinutes != null && lateMinutes > 0) {
      const employeeName = [employee.user.firstName, employee.user.lastName]
        .filter(Boolean)
        .join(' ');
      this.notifyManagersOfLateCheckin(
        companyId,
        employeeName,
        company.name ?? '',
        lateMinutes,
      );
    }

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
        user: { select: { firstName: true, lastName: true } },
        company: { select: { name: true, workStartHour: true } },
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

    // No geofence here, on purpose: this is a manager's correction (a missed
    // scan, a dead office screen), entered from wherever the manager is. The
    // guard is the role check above, not the office location.
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

    if (isLate && lateMinutes != null && lateMinutes > 0) {
      const employeeName = [employee.user.firstName, employee.user.lastName]
        .filter(Boolean)
        .join(' ');
      this.notifyManagersOfLateCheckin(
        employee.companyId,
        employeeName,
        employee.company.name ?? '',
        lateMinutes,
      );
    }

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
   * Fire-and-forget: notify all OWNER and MANAGER employees of the given
   * company that an employee checked in late. Safe to call without awaiting —
   * failures are logged as warnings and never surface to the caller.
   */
  private notifyManagersOfLateCheckin(
    companyId: string,
    employeeName: string,
    companyName: string,
    lateMinutes: number,
  ): void {
    const message = `⏰ ${employeeName} опоздал(а) на ${lateMinutes} мин — ${companyName}`;

    this.prisma.employee
      .findMany({
        where: {
          companyId,
          status: 'ACTIVE',
          role: { in: [EmployeeRole.OWNER, EmployeeRole.MANAGER] },
        },
        select: {
          user: { select: { telegramId: true } },
        },
      })
      .then((managers) => {
        for (const mgr of managers) {
          if (mgr.user.telegramId != null) {
            this.bot
              .notifyUser(mgr.user.telegramId, message)
              .catch((err: Error) =>
                this.logger.warn(`Late-checkin notify failed: ${err.message}`),
              );
          }
        }
      })
      .catch((err: Error) =>
        this.logger.warn(`notifyManagersOfLateCheckin query failed: ${err.message}`),
      );
  }

  /**
   * Determine whether the next CheckIn for this employee today should be IN
   * or OUT. If the most recent event today was an IN with no OUT after it,
   * the next is OUT; otherwise IN. This matches the pairing logic used by
   * the employee stats service.
   */
  /** Returns true if the employee's last check-in today was IN (no OUT yet). */
  async isEmployeeCurrentlyIn(employeeId: string): Promise<boolean> {
    return (await this.nextTypeFor(employeeId)) === CheckInType.OUT;
  }

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
   * +3h offset (Asia/Almaty) to stay consistent with EmployeeService —
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

  async todayPresence(
    companyId: string,
  ): Promise<{
    present: number;
    total: number;
    arrivedToday: number;
    companyName: string | null;
  }> {
    const today = startOfDay(new Date());

    const [activeEmployees, checkInsToday, company] = await Promise.all([
      // Exclude OWNER rows: the owner manages via web and isn't a check-in
      // participant, so counting them would skew both `total` and `allClear`.
      this.prisma.employee.findMany({
        where: { companyId, status: 'ACTIVE', role: { not: 'OWNER' } },
        select: { id: true },
      }),
      this.prisma.checkIn.findMany({
        where: {
          employee: { companyId },
          timestamp: { gte: today },
        },
        orderBy: { timestamp: 'desc' },
        select: { employeeId: true, type: true },
      }),
      this.prisma.company.findUnique({
        where: { id: companyId },
        select: { name: true },
      }),
    ]);

    // For each employee, the first entry in `checkInsToday` is their most recent
    // (ordered desc). If it's IN, they're currently present.
    const lastByEmployee = new Map<string, 'IN' | 'OUT'>();
    const arrivedSet = new Set<string>();
    for (const ci of checkInsToday) {
      if (!lastByEmployee.has(ci.employeeId)) {
        lastByEmployee.set(ci.employeeId, ci.type as 'IN' | 'OUT');
      }
      if (ci.type === 'IN') arrivedSet.add(ci.employeeId);
    }

    const present = [...lastByEmployee.values()].filter((t) => t === 'IN').length;
    return {
      present,
      total: activeEmployees.length,
      arrivedToday: arrivedSet.size,
      companyName: company?.name ?? null,
    };
  }
}
