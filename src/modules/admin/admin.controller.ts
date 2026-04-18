import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
  DefaultValuePipe,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { AdminService } from './admin.service';
import { SuperAdminGuard } from './guards/super-admin.guard';

/**
 * Parse SUPER_ADMIN_TELEGRAM_IDS (comma-separated) into a BigInt set. Kept in
 * sync with the parser inside SuperAdminGuard so whoami agrees with the
 * guard's verdict.
 */
function parseSuperAdminIds(raw: string | undefined): Set<bigint> {
  if (!raw) return new Set();
  const out = new Set<bigint>();
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    try {
      out.add(BigInt(trimmed));
    } catch {
      // ignore malformed entries
    }
  }
  return out;
}

/**
 * Platform super-admin REST surface. Most routes require SuperAdminGuard;
 * `whoami` is a lightweight auth-only probe so the frontend can decide
 * whether to surface the "Admin" navigation affordance without taking a
 * 403 on every page load.
 */
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  /**
   * Auth-only (JWT) probe answering "is the caller a super-admin?". Safe to
   * call from the main dashboard shell — returns 200 with `{isSuperAdmin:
   * false}` for regular users instead of 403, so the sidebar can render
   * without swallowing errors. The actual admin API is still guarded by
   * SuperAdminGuard; this endpoint only discloses the boolean membership.
   */
  @UseGuards(JwtAuthGuard)
  @Get('whoami')
  whoami(@Req() req: Request): { isSuperAdmin: boolean } {
    const user = (req.user ?? null) as { id?: string; telegramId?: string | bigint } | null;
    if (!user || user.telegramId == null) {
      return { isSuperAdmin: false };
    }
    const ids = parseSuperAdminIds(process.env.SUPER_ADMIN_TELEGRAM_IDS);
    if (ids.size === 0) return { isSuperAdmin: false };
    let callerId: bigint;
    try {
      callerId = typeof user.telegramId === 'bigint' ? user.telegramId : BigInt(user.telegramId);
    } catch {
      return { isSuperAdmin: false };
    }
    return { isSuperAdmin: ids.has(callerId) };
  }

  /** Global platform counters. */
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @Get('stats')
  stats() {
    return this.admin.stats();
  }

  /** Paginated company listing with optional name/slug search. */
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @Get('companies')
  listCompanies(
    @Query('limit', new DefaultValuePipe(25), ParseIntPipe) limit: number,
    @Query('cursor') cursor?: string,
    @Query('q') q?: string,
  ) {
    return this.admin.listCompanies({ limit, cursor, q });
  }

  /** Full details for a single company. */
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @Get('companies/:id')
  companyDetails(@Param('id') id: string) {
    return this.admin.companyDetails(id);
  }

  /** Soft-deactivate every employee of a company — effectively disables it. */
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @Post('companies/:id/deactivate')
  @HttpCode(HttpStatus.OK)
  deactivateCompany(@Param('id') id: string) {
    return this.admin.deactivateCompany(id);
  }

  /** Look up a user by telegramId or phone fragment. */
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @Get('users')
  listUsers(@Query('telegramId') telegramId?: string, @Query('phone') phone?: string) {
    return this.admin.listUsers({ telegramId, phone });
  }
}
