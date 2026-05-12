import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { EmployeeRole } from '@prisma/client';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { CompanyRoleGuard, RequireRole } from '../guards/company-role.guard';
import { AbsenceService } from './absence.service';
import { CreateAbsenceDto } from './absence.dto';

interface AuthedUser {
  id: string;
}

@ApiTags('absences')
@ApiBearerAuth('jwt')
@Controller('companies/:id/absences')
@UseGuards(CompanyRoleGuard)
export class AbsenceController {
  constructor(private readonly absenceService: AbsenceService) {}

  /**
   * GET /companies/:id/absences?month=YYYY-MM
   * Returns all absences for the company, optionally filtered to a month.
   * Any company member may read (no role restriction — CompanyRoleGuard
   * without @RequireRole is a no-op and falls through).
   */
  @Get()
  @RequireRole(
    EmployeeRole.OWNER,
    EmployeeRole.MANAGER,
    EmployeeRole.HR,
    EmployeeRole.STAFF,
  )
  @ApiOperation({ summary: 'List absences for a company (all roles)' })
  @ApiQuery({ name: 'month', required: false, description: 'YYYY-MM filter' })
  @ApiResponse({ status: 200, description: 'List of absences' })
  list(
    @Param('id') companyId: string,
    @Query('month') month?: string,
  ) {
    return this.absenceService.list(companyId, month);
  }

  /**
   * POST /companies/:id/absences
   * Create a new absence. OWNER or MANAGER only.
   */
  @Post()
  @RequireRole(EmployeeRole.OWNER, EmployeeRole.MANAGER, EmployeeRole.HR)
  @ApiOperation({ summary: 'Create an absence record (OWNER/MANAGER/HR)' })
  @ApiResponse({ status: 201, description: 'Absence created' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  create(
    @CurrentUser() user: AuthedUser,
    @Param('id') companyId: string,
    @Body() dto: CreateAbsenceDto,
  ) {
    return this.absenceService.create(user.id, companyId, dto);
  }

  /**
   * DELETE /companies/:id/absences/:absenceId
   * Delete an absence. OWNER or MANAGER only.
   */
  @Delete(':absenceId')
  @RequireRole(EmployeeRole.OWNER, EmployeeRole.MANAGER, EmployeeRole.HR)
  @ApiOperation({ summary: 'Delete an absence (OWNER/MANAGER/HR)' })
  @ApiResponse({ status: 200, description: 'Deleted' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  remove(
    @CurrentUser() user: AuthedUser,
    @Param('id') companyId: string,
    @Param('absenceId') absenceId: string,
  ) {
    return this.absenceService.remove(user.id, companyId, absenceId);
  }
}
