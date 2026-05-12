import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AbsenceStatus, EmployeeRole } from '@prisma/client';
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
   * GET /companies/:id/absences?month=YYYY-MM&status=PENDING|APPROVED|REJECTED
   * Returns absences for the company, optionally filtered to a month and/or status.
   */
  @Get()
  @RequireRole(EmployeeRole.OWNER, EmployeeRole.MANAGER, EmployeeRole.HR, EmployeeRole.STAFF)
  @ApiOperation({ summary: 'List absences for a company (all roles)' })
  @ApiQuery({ name: 'month', required: false, description: 'YYYY-MM filter' })
  @ApiQuery({ name: 'status', required: false, enum: AbsenceStatus, description: 'Status filter' })
  @ApiResponse({ status: 200, description: 'List of absences' })
  list(
    @Param('id') companyId: string,
    @Query('month') month?: string,
    @Query('status') status?: string,
  ) {
    let parsedStatus: AbsenceStatus | undefined;
    if (status) {
      if (!(status in AbsenceStatus)) {
        throw new BadRequestException(`Invalid status: ${status}`);
      }
      parsedStatus = status as AbsenceStatus;
    }
    return this.absenceService.list(companyId, month, parsedStatus);
  }

  /**
   * POST /companies/:id/absences
   * Create a new absence (APPROVED immediately). OWNER or MANAGER only.
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
   * PATCH /companies/:id/absences/:absenceId/approve
   * Approve a pending absence request. OWNER/MANAGER/HR only.
   */
  @Patch(':absenceId/approve')
  @RequireRole(EmployeeRole.OWNER, EmployeeRole.MANAGER, EmployeeRole.HR)
  @ApiOperation({ summary: 'Approve a pending absence (OWNER/MANAGER/HR)' })
  @ApiResponse({ status: 200, description: 'Absence approved' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  approve(
    @CurrentUser() user: AuthedUser,
    @Param('id') companyId: string,
    @Param('absenceId') absenceId: string,
  ) {
    return this.absenceService.approve(user.id, companyId, absenceId);
  }

  /**
   * PATCH /companies/:id/absences/:absenceId/reject
   * Reject a pending absence request. OWNER/MANAGER/HR only.
   */
  @Patch(':absenceId/reject')
  @RequireRole(EmployeeRole.OWNER, EmployeeRole.MANAGER, EmployeeRole.HR)
  @ApiOperation({ summary: 'Reject a pending absence (OWNER/MANAGER/HR)' })
  @ApiResponse({ status: 200, description: 'Absence rejected' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  reject(
    @CurrentUser() user: AuthedUser,
    @Param('id') companyId: string,
    @Param('absenceId') absenceId: string,
  ) {
    return this.absenceService.reject(user.id, companyId, absenceId);
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
