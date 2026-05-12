import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { RATE_LIMITS } from '@/common/throttle/throttle.constants';
import { PrismaService } from '@/common/prisma.service';
import { SheetsService } from './sheets.service';
import { ExportMonthSchema, type ExportMonthDto } from './dto/export-month.dto';
import { ExportReportSchema, type ExportReportDto } from './dto/export-report.dto';
import { normalizeLocale } from './sheets.i18n';

type JwtUser = { id: string; telegramId: string };

/**
 * HTTP surface for the Sheets export module.
 *
 * Only OWNER/MANAGER may trigger exports. We rely on the company-scoped
 * role guard that lives in the company module, but to avoid a circular
 * import we re-apply the check inline (companyId + user role) — if the
 * shared guard exists in this codebase, swap in @UseGuards there instead.
 */
@ApiTags('sheets')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard('jwt'))
@Controller('sheets')
export class SheetsController {
  private readonly logger = new Logger(SheetsController.name);

  constructor(
    private readonly sheets: SheetsService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('export/company/:companyId/monthly')
  @Throttle({ default: RATE_LIMITS.SHEETS_EXPORT })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Export a company month to Google Sheets',
    description:
      'Creates (or reuses) a spreadsheet for the company and writes the given month tab. OWNER/MANAGER only; caller must have an email in their profile so Google Sheets can share the spreadsheet with them.',
  })
  @ApiResponse({ status: 200, description: 'Export finished; spreadsheet URL returned' })
  @ApiResponse({ status: 400, description: 'Invalid month payload or missing profile email' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  async exportMonthly(
    @Req() req: Request,
    @Param('companyId') companyId: string,
    @Body() body: unknown,
  ) {
    const parsed = ExportMonthSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues.map((i) => i.message).join(', '));
    }
    const dto: ExportMonthDto = parsed.data;

    // Authorization: caller must be OWNER or MANAGER of the target company.
    // We check the employee row rather than Company.ownerId alone so elevated
    // managers (who are not the literal owner) also pass.
    const jwtUser = req.user as JwtUser;
    const employee = await this.prisma.employee.findFirst({
      where: {
        userId: jwtUser.id,
        companyId,
        status: 'ACTIVE',
        role: { in: ['OWNER', 'MANAGER'] },
      },
      select: { role: true },
    });
    if (!employee) {
      throw new ForbiddenException(
        'Экспорт доступен только владельцу или менеджеру компании',
      );
    }

    const localeHeader =
      (req.headers['x-locale'] as string | undefined) ??
      this.readLocaleFromCookie(req.headers.cookie);
    const locale = normalizeLocale(localeHeader);

    this.logger.log(
      `export requested company=${companyId} month=${dto.month} locale=${locale} by=${jwtUser.id}`,
    );
    return this.sheets.exportCompanyMonth(companyId, dto.month, locale);
  }

  @Post('timesheet')
  @Throttle({ default: RATE_LIMITS.SHEETS_EXPORT })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Export the monthly timesheet ("Табель") to Google Sheets',
    description:
      'Writes a Timesheet tab to the company spreadsheet (creating it if needed). OWNER/MANAGER only.',
  })
  @ApiResponse({ status: 200, description: 'Export finished; spreadsheet URL returned' })
  @ApiResponse({ status: 400, description: 'Invalid payload' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  async exportTimesheet(@Req() req: Request, @Body() body: unknown) {
    const dto = this.parseReportBody(body);
    await this.assertCompanyAdmin(req, dto.companyId);
    const locale = this.resolveLocale(req);
    const jwtUser = req.user as JwtUser;
    this.logger.log(
      `timesheet export requested company=${dto.companyId} month=${dto.month} locale=${locale} by=${jwtUser.id}`,
    );
    return this.sheets.exportTimesheet(jwtUser.id, dto.companyId, dto.month, locale);
  }

  @Post('payroll')
  @Throttle({ default: RATE_LIMITS.SHEETS_EXPORT })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Export the monthly payroll estimate to Google Sheets',
    description:
      'Writes a Payroll tab to the company spreadsheet (creating it if needed). OWNER/MANAGER only.',
  })
  @ApiResponse({ status: 200, description: 'Export finished; spreadsheet URL returned' })
  @ApiResponse({ status: 400, description: 'Invalid payload' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  async exportPayroll(@Req() req: Request, @Body() body: unknown) {
    const dto = this.parseReportBody(body);
    await this.assertCompanyAdmin(req, dto.companyId);
    const locale = this.resolveLocale(req);
    const jwtUser = req.user as JwtUser;
    this.logger.log(
      `payroll export requested company=${dto.companyId} month=${dto.month} locale=${locale} by=${jwtUser.id}`,
    );
    return this.sheets.exportPayroll(jwtUser.id, dto.companyId, dto.month, locale);
  }

  private parseReportBody(body: unknown): ExportReportDto {
    const parsed = ExportReportSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues.map((i) => i.message).join(', '));
    }
    return parsed.data;
  }

  private async assertCompanyAdmin(req: Request, companyId: string): Promise<void> {
    const jwtUser = req.user as JwtUser;
    const employee = await this.prisma.employee.findFirst({
      where: {
        userId: jwtUser.id,
        companyId,
        status: 'ACTIVE',
        role: { in: ['OWNER', 'MANAGER'] },
      },
      select: { role: true },
    });
    if (!employee) {
      throw new ForbiddenException(
        'Экспорт доступен только владельцу или менеджеру компании',
      );
    }
  }

  private resolveLocale(req: Request) {
    const localeHeader =
      (req.headers['x-locale'] as string | undefined) ??
      this.readLocaleFromCookie(req.headers.cookie);
    return normalizeLocale(localeHeader);
  }

  private readLocaleFromCookie(cookie: string | undefined): string | undefined {
    if (!cookie) return undefined;
    const match = cookie.split(';').find((c) => c.trim().startsWith('NEXT_LOCALE='));
    return match?.split('=')[1]?.trim();
  }

  @Get('company/:companyId/link')
  @ApiOperation({ summary: 'Get the stored spreadsheet link for a company' })
  @ApiResponse({ status: 200, description: 'Spreadsheet id, url, and creation time' })
  @ApiResponse({ status: 404, description: 'No spreadsheet created yet' })
  async getLink(@Param('companyId') companyId: string) {
    const stored = await this.sheets.getStored(companyId);
    if (!stored) {
      throw new NotFoundException('No spreadsheet has been created for this company yet');
    }
    return {
      spreadsheetId: stored.spreadsheetId,
      spreadsheetUrl: stored.url,
      createdAt: stored.createdAt,
    };
  }

  @Get('service-account')
  @ApiOperation({ summary: 'Get the service account email to share spreadsheets with' })
  async getServiceAccount() {
    const email = await this.sheets.getServiceAccountEmail();
    return { email };
  }

  @Post('company/:companyId/link')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Link a manually-created Google Sheet to a company',
    description:
      'Use this when the service account cannot create spreadsheets automatically. The user creates a sheet, shares it with the service account email as Editor, and posts the URL here.',
  })
  async setLink(
    @Req() req: Request,
    @Param('companyId') companyId: string,
    @Body() body: { url?: string },
  ) {
    const jwtUser = req.user as JwtUser;
    const employee = await this.prisma.employee.findFirst({
      where: {
        userId: jwtUser.id,
        companyId,
        status: 'ACTIVE',
        role: { in: ['OWNER', 'MANAGER'] },
      },
      select: { role: true },
    });
    if (!employee) {
      throw new ForbiddenException('Привязка доступна только владельцу или менеджеру');
    }
    const url = (body?.url ?? '').trim();
    if (!url) throw new BadRequestException('Пришлите URL или ID таблицы в поле url');
    const entry = await this.sheets.setManualSpreadsheet(companyId, url);
    return {
      spreadsheetId: entry.spreadsheetId,
      spreadsheetUrl: entry.url,
      createdAt: entry.createdAt,
    };
  }
}
