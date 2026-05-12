import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { EmployeeRole } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RATE_LIMITS } from '@/common/throttle/throttle.constants';
import { BotService } from '@/modules/telegram/bot.service';
import { ActivityService } from '@/modules/checkin/activity.service';
import { PresenceService } from '@/modules/checkin/presence.service';
import { CompanyService } from './company.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { InviteEmployeeDto } from './dto/invite-employee.dto';
import { BulkInviteDto } from './dto/bulk-invite.dto';
import { BulkUpdateEmployeesDto } from './dto/bulk-update-employees.dto';
import { CompanyRoleGuard, RequireRole } from './guards/company-role.guard';
import { SeatLimitGuard } from '@/modules/billing/guards/seat-limit.guard';

interface AuthedUser {
  id: string;
  telegramId?: bigint | string;
}

/**
 * REST API for company & employee management.
 *
 * Auth is expected to be applied globally (JwtAuthGuard) so every handler
 * here already has a `@CurrentUser()`. Role-based access within a company is
 * enforced by the local `CompanyRoleGuard`.
 */
@ApiTags('companies')
@ApiBearerAuth('jwt')
@Controller('companies')
@UseGuards(CompanyRoleGuard)
export class CompanyController {
  constructor(
    private readonly companyService: CompanyService,
    private readonly bot: BotService,
    private readonly activityService: ActivityService,
    private readonly presenceService: PresenceService,
  ) {}

  /** Create a new company; caller becomes its OWNER. */
  @Post()
  @ApiOperation({ summary: 'Create a company (caller becomes OWNER)' })
  @ApiResponse({ status: 201, description: 'Company created' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  create(@CurrentUser() user: AuthedUser, @Body() dto: CreateCompanyDto) {
    return this.companyService.create(user.id, dto);
  }

  /** List all companies the caller is an employee of. */
  @Get('my')
  @ApiOperation({ summary: 'List companies the caller belongs to' })
  @ApiResponse({ status: 200, description: 'List of companies' })
  findMy(@CurrentUser() user: AuthedUser) {
    return this.companyService.findMyCompanies(user.id);
  }

  /** Public-ish lookup by slug — caller must still be an employee. */
  @Get(':slug')
  @ApiOperation({ summary: 'Find a company by slug (must be an employee)' })
  @ApiResponse({ status: 200, description: 'Company returned' })
  @ApiResponse({ status: 403, description: 'Caller is not an employee' })
  @ApiResponse({ status: 404, description: 'Company not found' })
  findBySlug(@CurrentUser() user: AuthedUser, @Param('slug') slug: string) {
    return this.companyService.findBySlug(user.id, slug);
  }

  /** Update company settings — OWNER or MANAGER. */
  @Patch(':id')
  @RequireRole(EmployeeRole.OWNER, EmployeeRole.MANAGER)
  @ApiOperation({ summary: 'Update company settings (OWNER/MANAGER)' })
  @ApiResponse({ status: 200, description: 'Company updated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  update(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() dto: UpdateCompanyDto) {
    return this.companyService.update(user.id, id, dto);
  }

  /** Hard-delete a company. OWNER only. */
  @Delete(':id')
  @RequireRole(EmployeeRole.OWNER)
  @ApiOperation({ summary: 'Delete a company and all its data (OWNER)' })
  @ApiResponse({ status: 200, description: 'Company deleted' })
  @ApiResponse({ status: 403, description: 'OWNER required' })
  remove(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return this.companyService.remove(user.id, id);
  }

  /** Generate a Telegram deep-link invite for a new employee. */
  @Post(':id/employees/invite')
  @UseGuards(SeatLimitGuard)
  @Throttle({ default: RATE_LIMITS.TELEGRAM_INVITE })
  @RequireRole(EmployeeRole.OWNER, EmployeeRole.MANAGER, EmployeeRole.HR)
  @ApiOperation({ summary: 'Generate a Telegram invite deep-link (OWNER/MANAGER/HR)' })
  @ApiResponse({ status: 201, description: 'Invite link returned' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  invite(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() dto: InviteEmployeeDto) {
    return this.companyService.inviteEmployee(user.id, id, dto);
  }

  /** Live activity feed — recent check-ins, newest first. OWNER/MANAGER. */
  @Get(':id/activity')
  @RequireRole(EmployeeRole.OWNER, EmployeeRole.MANAGER, EmployeeRole.HR)
  @ApiOperation({ summary: 'Recent check-in activity for a company (OWNER/MANAGER/HR)' })
  @ApiQuery({ name: 'limit', required: false, description: 'Max items (1-100, default 20)' })
  @ApiResponse({ status: 200, description: 'List of recent check-ins, newest first' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  activity(
    @Param('id') id: string,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.activityService.recentForCompany(id, limit);
  }

  /** Who's checked in at the office right now. OWNER/MANAGER. */
  @Get(':id/presence/live')
  @RequireRole(EmployeeRole.OWNER, EmployeeRole.MANAGER)
  @ApiOperation({ summary: 'Live office presence for a company (OWNER/MANAGER)' })
  @ApiResponse({ status: 200, description: 'Presence snapshot' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  presenceLive(@Param('id') id: string) {
    return this.presenceService.liveForCompany(id);
  }

  /** Generate a batch of Telegram deep-link invites in one request. */
  @Post(':id/invites/bulk')
  @UseGuards(SeatLimitGuard)
  @Throttle({ default: RATE_LIMITS.TELEGRAM_INVITE })
  @RequireRole(EmployeeRole.OWNER, EmployeeRole.MANAGER, EmployeeRole.HR)
  @ApiOperation({ summary: 'Generate multiple Telegram invite deep-links (OWNER/MANAGER/HR)' })
  @ApiResponse({ status: 201, description: 'List of generated invites returned' })
  @ApiResponse({ status: 403, description: 'Insufficient role or seat limit reached' })
  bulkInvite(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() dto: BulkInviteDto,
  ) {
    return this.companyService.bulkInviteEmployees(user.id, id, dto.rows);
  }

  /** List employees of a company. Pass `?includeInactive=1` to include fired staff. */
  @Get(':id/employees')
  @RequireRole(EmployeeRole.OWNER, EmployeeRole.MANAGER, EmployeeRole.ACCOUNTANT, EmployeeRole.HR)
  @ApiOperation({ summary: 'List employees of a company (OWNER/MANAGER/ACCOUNTANT/HR)' })
  @ApiResponse({ status: 200, description: 'List of employees' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  listEmployees(@Param('id') id: string, @Query('includeInactive') includeInactive?: string) {
    const include = includeInactive === '1' || includeInactive === 'true';
    return this.companyService.listEmployees(id, include);
  }

  /** Bulk-update employees: assign department/shift or change status. OWNER/MANAGER. */
  @Patch(':id/employees/bulk')
  @RequireRole(EmployeeRole.OWNER, EmployeeRole.MANAGER)
  @ApiOperation({ summary: 'Bulk-update employees (OWNER/MANAGER)' })
  @ApiResponse({ status: 200, description: 'Number of employees updated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  bulkUpdateEmployees(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() dto: BulkUpdateEmployeesDto,
  ) {
    return this.companyService.bulkUpdateEmployees(user.id, id, dto);
  }

  /** Rich profile for a single employee. */
  @Get(':id/employees/:employeeId')
  @RequireRole(EmployeeRole.OWNER, EmployeeRole.MANAGER, EmployeeRole.ACCOUNTANT, EmployeeRole.HR)
  @ApiOperation({ summary: 'Get a single employee profile (OWNER/MANAGER/ACCOUNTANT/HR)' })
  @ApiResponse({ status: 200, description: 'Employee detail' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 404, description: 'Employee not found' })
  getEmployeeDetail(@Param('id') id: string, @Param('employeeId') employeeId: string) {
    return this.companyService.getEmployeeDetail(id, employeeId);
  }

  /** Update an employee's position, rate, or role. */
  @Patch(':id/employees/:employeeId')
  @RequireRole(EmployeeRole.OWNER, EmployeeRole.MANAGER, EmployeeRole.HR)
  @ApiOperation({ summary: 'Update an employee (OWNER/MANAGER/HR)' })
  @ApiResponse({ status: 200, description: 'Employee updated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  updateEmployee(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Param('employeeId') employeeId: string,
    @Body()
    body: {
      position?: string;
      monthlySalary?: number | null;
      hourlyRate?: number | null;
      role?: EmployeeRole;
      departmentId?: string | null;
      workStartHour?: number | null;
      workEndHour?: number | null;
      shiftId?: string | null;
    },
  ) {
    return this.companyService.updateEmployee(user.id, id, employeeId, body);
  }

  /** Soft-delete an employee (status=INACTIVE). OWNER only. */
  @Delete(':id/employees/:employeeId')
  @RequireRole(EmployeeRole.OWNER, EmployeeRole.HR)
  @ApiOperation({ summary: 'Deactivate an employee (OWNER/HR)' })
  @ApiResponse({ status: 200, description: 'Employee deactivated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  async deactivateEmployee(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Param('employeeId') employeeId: string,
  ) {
    const result = await this.companyService.deactivateEmployee(user.id, id, employeeId);
    void this.bot.notifyUser(
      result.fired.telegramId,
      `👋 ${result.fired.firstName ?? 'Здравствуйте'}, вы были уволены из компании «${result.fired.companyName}». До свидания!`,
    );
    return { ok: true };
  }
}
