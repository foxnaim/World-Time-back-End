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
import { CompanyRoleGuard, RequireRole } from '../guards/company-role.guard';
import { HolidayService } from './holiday.service';
import { CreateHolidayDto } from './holiday.dto';

/**
 * Company holiday calendar — non-working days that override the timesheet,
 * payroll working-day count, and attendance nudges.
 *
 * All routes require an OWNER / MANAGER / HR membership in the company named by
 * the `:id` route param (enforced by `CompanyRoleGuard`).
 */
@ApiTags('holidays')
@ApiBearerAuth('jwt')
@Controller('companies/:id/holidays')
@UseGuards(CompanyRoleGuard)
export class HolidayController {
  constructor(private readonly holidayService: HolidayService) {}

  @Get()
  @RequireRole(EmployeeRole.OWNER, EmployeeRole.MANAGER, EmployeeRole.HR)
  @ApiOperation({ summary: 'List company holidays for a year' })
  @ApiQuery({ name: 'year', required: false, description: 'YYYY (defaults to current year)' })
  @ApiResponse({ status: 200, description: 'List of holidays ordered by date' })
  list(@Param('id') companyId: string, @Query('year') year?: string) {
    const parsed = year ? Number(year) : undefined;
    return this.holidayService.list(
      companyId,
      parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined,
    );
  }

  @Post()
  @RequireRole(EmployeeRole.OWNER, EmployeeRole.MANAGER, EmployeeRole.HR)
  @ApiOperation({ summary: 'Create a company holiday' })
  @ApiResponse({ status: 201, description: 'Holiday created' })
  @ApiResponse({ status: 409, description: 'A holiday already exists for that date' })
  create(@Param('id') companyId: string, @Body() dto: CreateHolidayDto) {
    return this.holidayService.create(companyId, dto);
  }

  @Delete(':holidayId')
  @RequireRole(EmployeeRole.OWNER, EmployeeRole.MANAGER, EmployeeRole.HR)
  @ApiOperation({ summary: 'Delete a company holiday' })
  @ApiResponse({ status: 200, description: 'Deleted' })
  @ApiResponse({ status: 404, description: 'Holiday not found' })
  remove(@Param('id') companyId: string, @Param('holidayId') holidayId: string) {
    return this.holidayService.remove(companyId, holidayId);
  }
}
