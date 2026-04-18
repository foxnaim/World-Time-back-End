import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '@/common/decorators/current-user.decorator';

import { ManualEntryDto } from './dto/manual-entry.dto';
import { StartTimerDto } from './dto/start-timer.dto';
import { TimeEntryService } from './time-entry.service';

type JwtUser = { id: string; telegramId: string };

/**
 * TimeEntryController — timer / session endpoints for B2C freelancer side.
 *
 * All routes require auth (global JwtAuthGuard). Ownership of the project
 * behind each entry is enforced by {@link TimeEntryService}.
 */
@ApiTags('time-entries')
@ApiBearerAuth('jwt')
@Controller('time-entries')
export class TimeEntryController {
  constructor(private readonly timeEntryService: TimeEntryService) {}

  @Post('start')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start a timer on a project' })
  @ApiResponse({ status: 200, description: 'Timer started; entry returned' })
  @ApiResponse({ status: 409, description: 'Another timer is already running' })
  start(@CurrentUser() user: JwtUser, @Body() dto: StartTimerDto) {
    return this.timeEntryService.start(user.id, dto.projectId);
  }

  @Post(':id/stop')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Stop a running timer' })
  @ApiResponse({ status: 200, description: 'Timer stopped; entry finalised' })
  @ApiResponse({ status: 404, description: 'Entry not found or not owned' })
  stop(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.timeEntryService.stop(user.id, id);
  }

  @Get('active')
  @ApiOperation({ summary: 'Return the caller active timer, if any' })
  @ApiResponse({ status: 200, description: 'Active entry or null' })
  active(@CurrentUser() user: JwtUser) {
    return this.timeEntryService.active(user.id);
  }

  @Get()
  @ApiOperation({ summary: 'List time entries with optional filters' })
  @ApiQuery({ name: 'projectId', required: false })
  @ApiQuery({ name: 'from', required: false, description: 'ISO date/time' })
  @ApiQuery({ name: 'to', required: false, description: 'ISO date/time' })
  @ApiResponse({ status: 200, description: 'List of entries' })
  list(
    @CurrentUser() user: JwtUser,
    @Query('projectId') projectId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.timeEntryService.list(user.id, { projectId, from, to });
  }

  @Post('manual')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a manual time entry' })
  @ApiResponse({ status: 201, description: 'Entry created' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  manual(@CurrentUser() user: JwtUser, @Body() dto: ManualEntryDto) {
    return this.timeEntryService.createManual(user.id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a time entry' })
  @ApiResponse({ status: 200, description: 'Entry deleted' })
  @ApiResponse({ status: 404, description: 'Entry not found or not owned' })
  delete(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.timeEntryService.delete(user.id, id);
  }
}
