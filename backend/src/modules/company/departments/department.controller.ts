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
import { DepartmentService } from './department.service';
import { CreateDepartmentDto, UpdateDepartmentDto } from './department.dto';

interface AuthedUser {
  id: string;
}

@ApiTags('departments')
@ApiBearerAuth('jwt')
@Controller('companies/:id/departments')
@UseGuards(CompanyRoleGuard)
export class DepartmentController {
  constructor(private readonly departmentService: DepartmentService) {}

  /** List all departments for a company (any member can view). */
  @Get()
  @RequireRole(EmployeeRole.OWNER, EmployeeRole.MANAGER, EmployeeRole.HR)
  @ApiOperation({ summary: 'List departments of a company' })
  @ApiResponse({ status: 200, description: 'List of departments with employee counts' })
  list(@Param('id') companyId: string) {
    return this.departmentService.list(companyId);
  }

  /** Create a new department. OWNER or MANAGER only. */
  @Post()
  @RequireRole(EmployeeRole.OWNER, EmployeeRole.MANAGER, EmployeeRole.HR)
  @ApiOperation({ summary: 'Create a department (OWNER/MANAGER)' })
  @ApiResponse({ status: 201, description: 'Department created' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  create(
    @CurrentUser() user: AuthedUser,
    @Param('id') companyId: string,
    @Body() dto: CreateDepartmentDto,
  ) {
    return this.departmentService.create(user.id, companyId, dto);
  }

  /** Rename a department. OWNER or MANAGER only. */
  @Patch(':deptId')
  @RequireRole(EmployeeRole.OWNER, EmployeeRole.MANAGER, EmployeeRole.HR)
  @ApiOperation({ summary: 'Update a department (OWNER/MANAGER)' })
  @ApiResponse({ status: 200, description: 'Department updated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 404, description: 'Department not found' })
  update(
    @CurrentUser() user: AuthedUser,
    @Param('id') companyId: string,
    @Param('deptId') deptId: string,
    @Body() dto: UpdateDepartmentDto,
  ) {
    return this.departmentService.update(user.id, companyId, deptId, dto);
  }

  /** Delete a department; clears departmentId on all assigned employees. */
  @Delete(':deptId')
  @RequireRole(EmployeeRole.OWNER, EmployeeRole.MANAGER, EmployeeRole.HR)
  @ApiOperation({ summary: 'Delete a department (OWNER/MANAGER)' })
  @ApiResponse({ status: 200, description: 'Department deleted' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 404, description: 'Department not found' })
  remove(
    @CurrentUser() user: AuthedUser,
    @Param('id') companyId: string,
    @Param('deptId') deptId: string,
  ) {
    return this.departmentService.remove(user.id, companyId, deptId);
  }
}
