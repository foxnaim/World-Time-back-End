import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request, Response } from 'express';

import { EmployeeRole } from '@prisma/client';

import { CompanyRoleGuard, RequireRole } from '@/modules/company/guards/company-role.guard';

import { PayrollService } from './payroll.service';
import { ReportService } from './report.service';

type JwtUser = { id: string; telegramId: string };

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
 * Sanitise a string for use inside a Content-Disposition filename. Keeps
 * ASCII alnum plus `-_.` and replaces everything else with a hyphen so we
 * don't need to worry about the RFC 5987 `filename*` encoding dance.
 */
function safeFilename(input: string): string {
  return input.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-|-$/g, '');
}

@Controller('reports')
@UseGuards(AuthGuard('jwt'))
export class ReportController {
  constructor(private readonly reports: ReportService) {}

  /**
   * Monthly attendance PDF for a company. OWNER/MANAGER/ACCOUNTANT.
   */
  @Get('company/:companyId/attendance.pdf')
  @UseGuards(CompanyRoleGuard)
  @RequireRole(EmployeeRole.OWNER, EmployeeRole.MANAGER, EmployeeRole.ACCOUNTANT)
  async attendance(
    @Param('companyId') companyId: string,
    @Query('month') month: string,
    @Res() res: Response,
  ): Promise<void> {
    const m = assertMonth(month);
    const stream = await this.reports.buildAttendancePdf(companyId, m);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="attendance-${safeFilename(companyId)}-${m}.pdf"`,
    );
    res.setHeader('Cache-Control', 'private, no-store');

    stream.pipe(res);
  }

  /**
   * B2C freelance invoice. Always rendered against the caller's own data —
   * no way to request another user's invoice. Optional `projectId` narrows
   * the invoice to a single engagement.
   */
  @Get('user/invoice.pdf')
  async invoice(
    @Req() req: Request,
    @Query('month') month: string,
    @Query('projectId') projectId: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const { id: userId } = requireUser(req);
    const m = assertMonth(month);
    const stream = await this.reports.buildInvoicePdf(userId, m, projectId);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="invoice-${m}${projectId ? `-${safeFilename(projectId)}` : ''}.pdf"`,
    );
    res.setHeader('Cache-Control', 'private, no-store');

    stream.pipe(res);
  }
}

/**
 * Payroll estimate endpoint. Lives alongside the report controller (shares the
 * report module's date/timezone helpers) but is mounted under `/companies` so
 * the URL reads `GET /api/companies/:id/payroll?month=YYYY-MM`.
 *
 * OWNER/MANAGER only — enforced by CompanyRoleGuard reading the `:id` param.
 */
@Controller('companies')
@UseGuards(AuthGuard('jwt'), CompanyRoleGuard)
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  @Get(':id/payroll')
  @RequireRole(EmployeeRole.OWNER, EmployeeRole.MANAGER, EmployeeRole.ACCOUNTANT)
  async getPayroll(@Param('id') companyId: string, @Query('month') month: string) {
    const m = assertMonth(month);
    return this.payroll.getPayroll(companyId, m);
  }
}
