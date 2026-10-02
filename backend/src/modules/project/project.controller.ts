import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { endOfMonth, startOfMonth } from 'date-fns';

import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { PrismaService } from '@/common/prisma.service';

import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ProjectService } from './project.service';

type JwtUser = { id: string; telegramId: string };

/**
 * CSV-escape a single field: wrap in double quotes and double any internal
 * quotes if the value contains a comma, quote, CR, or LF.
 */
function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Filesystem-safe slug for the Content-Disposition filename. ASCII-only so
 * we avoid the RFC 5987 `filename*` encoding dance; anything outside
 * `[A-Za-z0-9._-]` becomes a hyphen.
 */
function slugify(input: string): string {
  return (
    input
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'project'
  );
}

/**
 * ProjectController — B2C freelancer project CRUD + monthly insight rollup.
 * All routes require auth (the global JwtAuthGuard covers this); ownership
 * is enforced by {@link ProjectService}.
 */
@ApiTags('projects')
@ApiBearerAuth('jwt')
@Controller('projects')
export class ProjectController {
  constructor(
    private readonly projectService: ProjectService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a freelancer project' })
  @ApiResponse({ status: 201, description: 'Project created' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  create(@CurrentUser() user: JwtUser, @Body() dto: CreateProjectDto) {
    return this.projectService.create(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List caller projects' })
  @ApiResponse({ status: 200, description: 'List of projects' })
  list(@CurrentUser() user: JwtUser) {
    return this.projectService.list(user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single project by id' })
  @ApiResponse({ status: 200, description: 'Project returned' })
  @ApiResponse({ status: 404, description: 'Project not found or not owned' })
  findOne(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.projectService.findOne(user.id, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a project' })
  @ApiResponse({ status: 200, description: 'Project updated' })
  @ApiResponse({ status: 404, description: 'Project not found or not owned' })
  update(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() dto: UpdateProjectDto) {
    return this.projectService.update(user.id, id, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete (or soft-archive) a project',
    description: 'Pass ?force=true to hard-delete even when time entries exist.',
  })
  @ApiQuery({ name: 'force', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Project deleted or archived' })
  @ApiResponse({ status: 404, description: 'Project not found or not owned' })
  delete(@CurrentUser() user: JwtUser, @Param('id') id: string, @Query('force') force?: string) {
    return this.projectService.delete(user.id, id, force === 'true');
  }

  @Get(':id/monthly-summary')
  @ApiOperation({ summary: 'Monthly aggregated hours and earnings for a project' })
  @ApiQuery({ name: 'month', required: true, description: 'YYYY-MM' })
  @ApiResponse({ status: 200, description: 'Monthly summary returned' })
  @ApiResponse({ status: 400, description: 'month query param missing or malformed' })
  monthlySummary(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Query('month') month?: string,
  ) {
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      throw new BadRequestException('month query param required, format YYYY-MM');
    }
    return this.projectService.monthlySummary(user.id, id, month);
  }

  @Get(':id/export.csv')
  @ApiOperation({
    summary: 'Export project time entries as CSV',
    description:
      'Plain CSV download of time entries in the given date range. Defaults to the current month when `from`/`to` are omitted.',
  })
  @ApiQuery({ name: 'from', required: false, description: 'ISO date (inclusive)' })
  @ApiQuery({ name: 'to', required: false, description: 'ISO date (exclusive-or-end)' })
  @ApiResponse({ status: 200, description: 'CSV file stream' })
  @ApiResponse({ status: 403, description: 'Not the project owner' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  async exportCsv(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Res() res: Response,
    @Query('from') fromStr?: string,
    @Query('to') toStr?: string,
  ): Promise<void> {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) throw new NotFoundException('Project not found');
    if (project.userId !== user.id) {
      throw new ForbiddenException('Not your project');
    }

    const now = new Date();
    let from = startOfMonth(now);
    let to = endOfMonth(now);
    if (fromStr) {
      const parsed = new Date(fromStr);
      if (Number.isNaN(parsed.getTime())) {
        throw new BadRequestException('Invalid `from` date');
      }
      from = parsed;
    }
    if (toStr) {
      const parsed = new Date(toStr);
      if (Number.isNaN(parsed.getTime())) {
        throw new BadRequestException('Invalid `to` date');
      }
      to = parsed;
    }

    const entries = await this.prisma.timeEntry.findMany({
      where: {
        projectId: id,
        startedAt: { gte: from, lte: to },
      },
      orderBy: { startedAt: 'asc' },
    });

    const hourlyRate =
      project.hourlyRate != null ? new Prisma.Decimal(project.hourlyRate) : null;

    const header = 'startedAt,endedAt,durationMinutes,note,hourlyRate,earnings';
    const lines: string[] = [header];
    for (const e of entries) {
      const durationMinutes =
        e.durationSec != null ? Math.round(e.durationSec / 60).toString() : '';
      let earningsStr = '';
      if (hourlyRate && e.durationSec != null) {
        const earnings = hourlyRate.mul(e.durationSec).div(3600);
        earningsStr = earnings.toFixed(2);
      }
      lines.push(
        [
          csvEscape(e.startedAt.toISOString()),
          csvEscape(e.endedAt ? e.endedAt.toISOString() : ''),
          csvEscape(durationMinutes),
          csvEscape(e.note ?? ''),
          csvEscape(hourlyRate ? hourlyRate.toFixed(2) : ''),
          csvEscape(earningsStr),
        ].join(','),
      );
    }
    // Trailing newline keeps POSIX tools happy.
    const body = lines.join('\n') + '\n';

    const ym = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}`;
    const filename = `project-${slugify(project.name)}-${ym}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(body);
  }
}
