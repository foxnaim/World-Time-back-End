import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, TimeEntry } from '@tact/database';
import type { TimeEntryResponse } from '@tact/types';

import { PrismaService } from '@/common/prisma.service';

import { ManualEntryDto } from './dto/manual-entry.dto';

/**
 * TimeEntryService
 *
 * Timer / session tracking for freelancers. Core invariant enforced here:
 * a user may have AT MOST ONE open entry (endedAt = null) at any time,
 * across all their projects — if they start a new one, we close the old.
 *
 * Ownership is verified by joining through Project.userId.
 */
@Injectable()
export class TimeEntryService {
  private readonly logger = new Logger(TimeEntryService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Start a timer on a project. If the user has any open entry (on this or
   * any other project), stop it first so only one is ever open.
   */
  async start(userId: string, projectId: string): Promise<TimeEntryResponse> {
    await this.assertProjectOwnership(userId, projectId);

    // Close any currently-open entry for this user.
    await this.closeAllOpenForUser(userId);

    const now = new Date();
    const created = await this.prisma.timeEntry.create({
      data: {
        projectId,
        startedAt: now,
      },
    });
    this.logger.log(`time-entry.start id=${created.id} projectId=${projectId} userId=${userId}`);
    return this.serialize(created, userId);
  }

  async stop(userId: string, entryId: string): Promise<TimeEntryResponse> {
    const entry = await this.prisma.timeEntry.findUnique({
      where: { id: entryId },
      include: { project: true },
    });
    if (!entry) throw new NotFoundException('Entry not found');
    if (entry.project.userId !== userId) {
      throw new ForbiddenException('Not your entry');
    }
    if (entry.endedAt) {
      throw new ConflictException('Entry is already stopped');
    }

    const endedAt = new Date();
    const durationSec = Math.max(
      0,
      Math.floor((endedAt.getTime() - entry.startedAt.getTime()) / 1000),
    );
    const updated = await this.prisma.timeEntry.update({
      where: { id: entryId },
      data: { endedAt, durationSec },
    });
    this.logger.log(`time-entry.stop id=${entryId} durationSec=${durationSec} userId=${userId}`);
    return this.serialize(updated, userId);
  }

  async active(userId: string): Promise<TimeEntryResponse | null> {
    const entry = await this.prisma.timeEntry.findFirst({
      where: {
        endedAt: null,
        project: { userId },
      },
      orderBy: { startedAt: 'desc' },
    });
    return entry ? this.serialize(entry, userId) : null;
  }

  async list(
    userId: string,
    filter: { projectId?: string; from?: string; to?: string },
  ): Promise<TimeEntryResponse[]> {
    const where: Prisma.TimeEntryWhereInput = {
      project: { userId },
    };
    if (filter.projectId) where.projectId = filter.projectId;
    if (filter.from || filter.to) {
      const startedAt: Prisma.DateTimeFilter = {};
      if (filter.from) {
        const d = new Date(filter.from);
        if (Number.isNaN(d.getTime())) {
          throw new BadRequestException('Invalid `from` date');
        }
        startedAt.gte = d;
      }
      if (filter.to) {
        const d = new Date(filter.to);
        if (Number.isNaN(d.getTime())) {
          throw new BadRequestException('Invalid `to` date');
        }
        startedAt.lte = d;
      }
      where.startedAt = startedAt;
    }
    const entries = await this.prisma.timeEntry.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      take: 500,
    });
    return entries.map((e) => this.serialize(e, userId));
  }

  async createManual(userId: string, dto: ManualEntryDto): Promise<TimeEntryResponse> {
    await this.assertProjectOwnership(userId, dto.projectId);

    const startedAt = new Date(dto.startedAt);
    const endedAt = new Date(dto.endedAt);
    if (startedAt.getTime() >= endedAt.getTime()) {
      throw new BadRequestException('startedAt must be before endedAt');
    }
    const durationSec = Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000);
    const created = await this.prisma.timeEntry.create({
      data: {
        projectId: dto.projectId,
        startedAt,
        endedAt,
        durationSec,
        note: dto.note ?? null,
      },
    });
    this.logger.log(
      `time-entry.manual id=${created.id} projectId=${dto.projectId} userId=${userId}`,
    );
    return this.serialize(created, userId);
  }

  async delete(userId: string, entryId: string): Promise<{ ok: true }> {
    const entry = await this.prisma.timeEntry.findUnique({
      where: { id: entryId },
      include: { project: true },
    });
    if (!entry) throw new NotFoundException('Entry not found');
    if (entry.project.userId !== userId) {
      throw new ForbiddenException('Not your entry');
    }
    await this.prisma.timeEntry.delete({ where: { id: entryId } });
    this.logger.log(`time-entry.delete id=${entryId} userId=${userId}`);
    return { ok: true };
  }

  // ---------- helpers ----------

  /**
   * Close all open entries for the given user. In practice there should be
   * at most one; the loop is defensive against any drift in the invariant.
   */
  private async closeAllOpenForUser(userId: string): Promise<void> {
    const open = await this.prisma.timeEntry.findMany({
      where: {
        endedAt: null,
        project: { userId },
      },
    });
    if (open.length === 0) return;

    const now = new Date();
    await this.prisma.$transaction(
      open.map((e) =>
        this.prisma.timeEntry.update({
          where: { id: e.id },
          data: {
            endedAt: now,
            durationSec: Math.max(0, Math.floor((now.getTime() - e.startedAt.getTime()) / 1000)),
          },
        }),
      ),
    );
    this.logger.log(`time-entry.auto-closed count=${open.length} userId=${userId}`);
  }

  private async assertProjectOwnership(userId: string, projectId: string): Promise<void> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, userId: true },
    });
    if (!project) throw new NotFoundException('Project not found');
    if (project.userId !== userId) {
      throw new ForbiddenException('Not your project');
    }
  }

  private serialize(e: TimeEntry, userId: string): TimeEntryResponse {
    return {
      id: e.id,
      projectId: e.projectId,
      userId,
      startedAt: e.startedAt.toISOString(),
      stoppedAt: e.endedAt ? e.endedAt.toISOString() : null,
      durationSec: e.durationSec ?? null,
      note: e.note ?? null,
      createdAt: e.createdAt.toISOString(),
    };
  }
}
