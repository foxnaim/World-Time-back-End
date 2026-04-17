import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
  DefaultValuePipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { AdminService } from './admin.service';
import { SuperAdminGuard } from './guards/super-admin.guard';

/**
 * Platform super-admin REST surface. All routes require a logged-in user
 * whose Telegram ID appears in SUPER_ADMIN_TELEGRAM_IDS.
 */
@Controller('admin')
@UseGuards(JwtAuthGuard, SuperAdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  /** Global platform counters. */
  @Get('stats')
  stats() {
    return this.admin.stats();
  }

  /** Paginated company listing with optional name/slug search. */
  @Get('companies')
  listCompanies(
    @Query('limit', new DefaultValuePipe(25), ParseIntPipe) limit: number,
    @Query('cursor') cursor?: string,
    @Query('q') q?: string,
  ) {
    return this.admin.listCompanies({ limit, cursor, q });
  }

  /** Full details for a single company. */
  @Get('companies/:id')
  companyDetails(@Param('id') id: string) {
    return this.admin.companyDetails(id);
  }

  /** Soft-deactivate every employee of a company — effectively disables it. */
  @Post('companies/:id/deactivate')
  @HttpCode(HttpStatus.OK)
  deactivateCompany(@Param('id') id: string) {
    return this.admin.deactivateCompany(id);
  }

  /** Look up a user by telegramId or phone fragment. */
  @Get('users')
  listUsers(
    @Query('telegramId') telegramId?: string,
    @Query('phone') phone?: string,
  ) {
    return this.admin.listUsers({ telegramId, phone });
  }
}
