import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';

import { TimesheetService, type TimesheetResult } from './timesheet.service';

type JwtUser = { id: string; telegramId?: string };

function requireUser(req: Request): JwtUser {
  const user = req.user as JwtUser | undefined;
  if (!user?.id) throw new UnauthorizedException('Authentication required');
  return user;
}

function assertMonth(month: string | undefined): string {
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    throw new BadRequestException('Query param `month` must be YYYY-MM');
  }
  return month;
}

/**
 * Monthly timesheet ("Табель") endpoint. Lives in the report module since it
 * shares the same date/timezone helpers as the attendance PDF, but is mounted
 * under `/companies/:id/timesheet` to sit alongside the other company routes.
 *
 * OWNER/MANAGER only — enforced inside TimesheetService against the caller's
 * membership (the route param here is `:id`, which the shared CompanyAdminGuard
 * doesn't read, so we do the check in the service instead).
 */
@Controller('companies')
@UseGuards(AuthGuard('jwt'))
export class TimesheetController {
  constructor(private readonly timesheet: TimesheetService) {}

  @Get(':id/timesheet')
  async getTimesheet(
    @Req() req: Request,
    @Param('id') companyId: string,
    @Query('month') month: string,
  ): Promise<TimesheetResult> {
    const { id: userId } = requireUser(req);
    const m = assertMonth(month);
    return this.timesheet.getTimesheet(companyId, m, userId);
  }
}
