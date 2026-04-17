import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { EmployeeRole } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RATE_LIMITS } from '@/common/throttle/throttle.constants';
import { CompanyService } from './company.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { InviteEmployeeDto } from './dto/invite-employee.dto';
import {
  CompanyRoleGuard,
  RequireRole,
} from './guards/company-role.guard';

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
  constructor(private readonly companyService: CompanyService) {}

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
  findBySlug(
    @CurrentUser() user: AuthedUser,
    @Param('slug') slug: string,
  ) {
    return this.companyService.findBySlug(user.id, slug);
  }

  /** Update company settings — OWNER or MANAGER. */
  @Patch(':id')
  @RequireRole(EmployeeRole.OWNER, EmployeeRole.MANAGER)
  @ApiOperation({ summary: 'Update company settings (OWNER/MANAGER)' })
  @ApiResponse({ status: 200, description: 'Company updated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  update(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() dto: UpdateCompanyDto,
  ) {
    return this.companyService.update(user.id, id, dto);
  }

  /** Generate a Telegram deep-link invite for a new employee. */
  @Post(':id/employees/invite')
  @Throttle({ default: RATE_LIMITS.TELEGRAM_INVITE })
  @RequireRole(EmployeeRole.OWNER, EmployeeRole.MANAGER)
  @ApiOperation({ summary: 'Generate a Telegram invite deep-link (OWNER/MANAGER)' })
  @ApiResponse({ status: 201, description: 'Invite link returned' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  invite(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() dto: InviteEmployeeDto,
  ) {
    return this.companyService.inviteEmployee(user.id, id, dto);
  }

  /** List employees of a company. */
  @Get(':id/employees')
  @RequireRole(EmployeeRole.OWNER, EmployeeRole.MANAGER)
  @ApiOperation({ summary: 'List employees of a company (OWNER/MANAGER)' })
  @ApiResponse({ status: 200, description: 'List of employees' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  listEmployees(@Param('id') id: string) {
    return this.companyService.listEmployees(id);
  }

  /** Update an employee's position, rate, or role. */
  @Patch(':id/employees/:employeeId')
  @RequireRole(EmployeeRole.OWNER, EmployeeRole.MANAGER)
  @ApiOperation({ summary: 'Update an employee (OWNER/MANAGER)' })
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
    },
  ) {
    return this.companyService.updateEmployee(user.id, id, employeeId, body);
  }

  /** Soft-delete an employee (status=INACTIVE). OWNER only. */
  @Delete(':id/employees/:employeeId')
  @RequireRole(EmployeeRole.OWNER)
  @ApiOperation({ summary: 'Deactivate an employee (OWNER)' })
  @ApiResponse({ status: 200, description: 'Employee deactivated' })
  @ApiResponse({ status: 403, description: 'OWNER required' })
  deactivateEmployee(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Param('employeeId') employeeId: string,
  ) {
    return this.companyService.deactivateEmployee(user.id, id, employeeId);
  }
}
