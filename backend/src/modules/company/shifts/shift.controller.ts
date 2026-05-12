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
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { EmployeeRole } from '@prisma/client';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { CompanyRoleGuard, RequireRole } from '../guards/company-role.guard';
import { ShiftService } from './shift.service';
import { CreateShiftDto, UpdateShiftDto } from './shift.dto';

interface AuthedUser {
  id: string;
}

@ApiTags('shifts')
@ApiBearerAuth('jwt')
@Controller('companies/:id/shifts')
@UseGuards(CompanyRoleGuard)
export class ShiftController {
  constructor(private readonly shiftService: ShiftService) {}

  /** List all shifts for a company (OWNER/MANAGER). */
  @Get()
  @RequireRole(EmployeeRole.OWNER, EmployeeRole.MANAGER, EmployeeRole.HR)
  @ApiOperation({ summary: 'List shifts of a company' })
  @ApiResponse({ status: 200, description: 'List of shifts with employee counts' })
  list(@Param('id') companyId: string) {
    return this.shiftService.list(companyId);
  }

  /** Create a new shift. OWNER or MANAGER only. */
  @Post()
  @RequireRole(EmployeeRole.OWNER, EmployeeRole.MANAGER, EmployeeRole.HR)
  @ApiOperation({ summary: 'Create a shift (OWNER/MANAGER)' })
  @ApiResponse({ status: 201, description: 'Shift created' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  create(
    @CurrentUser() user: AuthedUser,
    @Param('id') companyId: string,
    @Body() dto: CreateShiftDto,
  ) {
    return this.shiftService.create(user.id, companyId, dto);
  }

  /** Update a shift. OWNER or MANAGER only. */
  @Patch(':shiftId')
  @RequireRole(EmployeeRole.OWNER, EmployeeRole.MANAGER, EmployeeRole.HR)
  @ApiOperation({ summary: 'Update a shift (OWNER/MANAGER)' })
  @ApiResponse({ status: 200, description: 'Shift updated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 404, description: 'Shift not found' })
  update(
    @CurrentUser() user: AuthedUser,
    @Param('id') companyId: string,
    @Param('shiftId') shiftId: string,
    @Body() dto: UpdateShiftDto,
  ) {
    return this.shiftService.update(user.id, companyId, shiftId, dto);
  }

  /** Delete a shift; clears shiftId on all assigned employees. */
  @Delete(':shiftId')
  @RequireRole(EmployeeRole.OWNER, EmployeeRole.MANAGER, EmployeeRole.HR)
  @ApiOperation({ summary: 'Delete a shift (OWNER/MANAGER)' })
  @ApiResponse({ status: 200, description: 'Shift deleted' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 404, description: 'Shift not found' })
  remove(
    @CurrentUser() user: AuthedUser,
    @Param('id') companyId: string,
    @Param('shiftId') shiftId: string,
  ) {
    return this.shiftService.remove(user.id, companyId, shiftId);
  }

  /** Assign an employee to this shift. OWNER or MANAGER only. */
  @Post(':shiftId/employees/:employeeId')
  @RequireRole(EmployeeRole.OWNER, EmployeeRole.MANAGER, EmployeeRole.HR)
  @ApiOperation({ summary: 'Assign an employee to a shift (OWNER/MANAGER)' })
  @ApiResponse({ status: 201, description: 'Employee assigned to shift' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 404, description: 'Shift or employee not found' })
  assignEmployee(
    @CurrentUser() user: AuthedUser,
    @Param('id') companyId: string,
    @Param('shiftId') shiftId: string,
    @Param('employeeId') employeeId: string,
  ) {
    return this.shiftService.assignEmployee(user.id, companyId, shiftId, employeeId);
  }
}
