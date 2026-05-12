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
import { LocationService } from './location.service';
import { CreateLocationDto, UpdateLocationDto } from './location.dto';

interface AuthedUser {
  id: string;
}

@ApiTags('locations')
@ApiBearerAuth('jwt')
@Controller('companies/:id/locations')
@UseGuards(CompanyRoleGuard)
export class LocationController {
  constructor(private readonly locationService: LocationService) {}

  /** List all locations for a company. */
  @Get()
  @ApiOperation({ summary: 'List locations for a company' })
  @ApiResponse({ status: 200, description: 'List of locations' })
  list(@Param('id') id: string) {
    return this.locationService.list(id);
  }

  /** Create a location. OWNER or MANAGER only. */
  @Post()
  @RequireRole(EmployeeRole.OWNER, EmployeeRole.MANAGER, EmployeeRole.HR)
  @ApiOperation({ summary: 'Create a location (OWNER/MANAGER)' })
  @ApiResponse({ status: 201, description: 'Location created' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  create(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() dto: CreateLocationDto,
  ) {
    return this.locationService.create(user.id, id, dto);
  }

  /** Update a location. OWNER or MANAGER only. */
  @Patch(':locationId')
  @RequireRole(EmployeeRole.OWNER, EmployeeRole.MANAGER, EmployeeRole.HR)
  @ApiOperation({ summary: 'Update a location (OWNER/MANAGER)' })
  @ApiResponse({ status: 200, description: 'Location updated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 404, description: 'Location not found' })
  update(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Param('locationId') locationId: string,
    @Body() dto: UpdateLocationDto,
  ) {
    return this.locationService.update(user.id, id, locationId, dto);
  }

  /** Delete a location. OWNER or MANAGER only. */
  @Delete(':locationId')
  @RequireRole(EmployeeRole.OWNER, EmployeeRole.MANAGER, EmployeeRole.HR)
  @ApiOperation({ summary: 'Delete a location (OWNER/MANAGER)' })
  @ApiResponse({ status: 200, description: 'Location deleted' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 404, description: 'Location not found' })
  remove(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Param('locationId') locationId: string,
  ) {
    return this.locationService.remove(user.id, id, locationId);
  }
}
