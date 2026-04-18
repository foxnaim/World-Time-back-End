import {
  BadRequestException,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { AnalyticsService } from './analytics.service';
import { CompanyAdminGuard } from './guards/company-admin.guard';

type JwtUser = { id: string; telegramId: string };

/**
 * Resolve the current authenticated user from `req.user`, throwing a clean
 * 401 if the JWT guard somehow let an anonymous request through.
 */
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

@ApiTags('analytics')
@ApiBearerAuth('jwt')
@Controller('analytics')
@UseGuards(AuthGuard('jwt'))
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  // ---------------------------------------------------------------------------
  // B2B
  // ---------------------------------------------------------------------------

  @Get('company/:companyId/late-stats')
  @UseGuards(CompanyAdminGuard)
  @ApiOperation({ summary: 'Monthly late-arrival stats per employee (OWNER/MANAGER)' })
  @ApiQuery({ name: 'month', required: true, description: 'YYYY-MM' })
  @ApiResponse({ status: 200, description: 'Late-arrival stats returned' })
  @ApiResponse({ status: 403, description: 'Not a company admin' })
  async companyLateStats(@Param('companyId') companyId: string, @Query('month') month: string) {
    return this.analytics.getCompanyLateStats(companyId, assertMonth(month));
  }

  @Get('company/:companyId/ranking')
  @UseGuards(CompanyAdminGuard)
  @ApiOperation({ summary: 'Monthly employee ranking by worked hours (OWNER/MANAGER)' })
  @ApiQuery({ name: 'month', required: true, description: 'YYYY-MM' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Ranking returned' })
  @ApiResponse({ status: 403, description: 'Not a company admin' })
  async companyRanking(
    @Param('companyId') companyId: string,
    @Query('month') month: string,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ) {
    return this.analytics.getCompanyRanking(companyId, assertMonth(month), limit);
  }

  @Get('company/:companyId/overtime')
  @UseGuards(CompanyAdminGuard)
  @ApiOperation({ summary: 'Monthly overtime hours per employee (OWNER/MANAGER)' })
  @ApiQuery({ name: 'month', required: true, description: 'YYYY-MM' })
  @ApiResponse({ status: 200, description: 'Overtime stats returned' })
  @ApiResponse({ status: 403, description: 'Not a company admin' })
  async companyOvertime(@Param('companyId') companyId: string, @Query('month') month: string) {
    return this.analytics.getCompanyOvertime(companyId, assertMonth(month));
  }

  @Get('company/:companyId/summary')
  @UseGuards(CompanyAdminGuard)
  @ApiOperation({ summary: 'Monthly aggregate summary for a company (OWNER/MANAGER)' })
  @ApiQuery({ name: 'month', required: true, description: 'YYYY-MM' })
  @ApiResponse({ status: 200, description: 'Company summary returned' })
  @ApiResponse({ status: 403, description: 'Not a company admin' })
  async companySummary(@Param('companyId') companyId: string, @Query('month') month: string) {
    return this.analytics.getCompanySummary(companyId, assertMonth(month));
  }

  @Get('company/:companyId/payouts')
  @UseGuards(CompanyAdminGuard)
  @ApiOperation({ summary: 'Monthly per-employee payout breakdown (OWNER/MANAGER)' })
  @ApiQuery({ name: 'month', required: true, description: 'YYYY-MM' })
  @ApiResponse({ status: 200, description: 'Payouts returned' })
  @ApiResponse({ status: 403, description: 'Not a company admin' })
  async companyPayouts(@Param('companyId') companyId: string, @Query('month') month: string) {
    return this.analytics.getCompanyPayouts(companyId, assertMonth(month));
  }

  // ---------------------------------------------------------------------------
  // B2C (current user only)
  // ---------------------------------------------------------------------------

  @Get('user/real-hourly-rate')
  @ApiOperation({ summary: 'Real effective hourly rate for the caller, per month' })
  @ApiQuery({ name: 'month', required: true, description: 'YYYY-MM' })
  @ApiResponse({ status: 200, description: 'Rate returned' })
  async userRealHourlyRate(@Req() req: Request, @Query('month') month: string) {
    const { id } = requireUser(req);
    return this.analytics.getUserRealHourlyRate(id, assertMonth(month));
  }

  @Get('user/project/:projectId/rate-history')
  @ApiOperation({ summary: 'Rolling per-project hourly rate history for the caller' })
  @ApiQuery({ name: 'months', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Rate history returned' })
  async userProjectRateHistory(
    @Req() req: Request,
    @Param('projectId') projectId: string,
    @Query('months', new DefaultValuePipe(6), ParseIntPipe) months: number,
  ) {
    const { id } = requireUser(req);
    return this.analytics.getProjectRateHistory(id, projectId, months);
  }
}
