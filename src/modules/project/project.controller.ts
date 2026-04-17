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
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '@/common/decorators/current-user.decorator';

import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ProjectService } from './project.service';

type JwtUser = { id: string; telegramId: string };

/**
 * ProjectController — B2C freelancer project CRUD + monthly insight rollup.
 * All routes require auth (the global JwtAuthGuard covers this); ownership
 * is enforced by {@link ProjectService}.
 */
@ApiTags('projects')
@ApiBearerAuth('jwt')
@Controller('projects')
export class ProjectController {
  constructor(private readonly projectService: ProjectService) {}

  @Post()
  @ApiOperation({ summary: 'Create a freelancer project' })
  @ApiResponse({ status: 201, description: 'Project created' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  create(
    @CurrentUser() user: JwtUser,
    @Body() dto: CreateProjectDto,
  ) {
    return this.projectService.create(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List caller projects' })
  @ApiResponse({ status: 200, description: 'List of projects' })
  list(@CurrentUser() user: JwtUser) {
    return this.projectService.list(user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single project by id' })
  @ApiResponse({ status: 200, description: 'Project returned' })
  @ApiResponse({ status: 404, description: 'Project not found or not owned' })
  findOne(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
  ) {
    return this.projectService.findOne(user.id, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a project' })
  @ApiResponse({ status: 200, description: 'Project updated' })
  @ApiResponse({ status: 404, description: 'Project not found or not owned' })
  update(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projectService.update(user.id, id, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete (or soft-archive) a project',
    description: 'Pass ?force=true to hard-delete even when time entries exist.',
  })
  @ApiQuery({ name: 'force', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Project deleted or archived' })
  @ApiResponse({ status: 404, description: 'Project not found or not owned' })
  delete(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Query('force') force?: string,
  ) {
    return this.projectService.delete(user.id, id, force === 'true');
  }

  @Get(':id/monthly-summary')
  @ApiOperation({ summary: 'Monthly aggregated hours and earnings for a project' })
  @ApiQuery({ name: 'month', required: true, description: 'YYYY-MM' })
  @ApiResponse({ status: 200, description: 'Monthly summary returned' })
  @ApiResponse({ status: 400, description: 'month query param missing or malformed' })
  monthlySummary(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Query('month') month?: string,
  ) {
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      throw new BadRequestException('month query param required, format YYYY-MM');
    }
    return this.projectService.monthlySummary(user.id, id, month);
  }
}
