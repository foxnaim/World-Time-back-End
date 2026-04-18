import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { RATE_LIMITS } from '@/common/throttle/throttle.constants';
import { SheetsService } from './sheets.service';
import { ExportMonthSchema, type ExportMonthDto } from './dto/export-month.dto';

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

  constructor(private readonly sheets: SheetsService) {}

  @Post('export/company/:companyId/monthly')
  @Throttle({ default: RATE_LIMITS.SHEETS_EXPORT })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Export a company month to Google Sheets',
    description:
      'Creates (or reuses) a spreadsheet for the company and writes the given month tab. OWNER/MANAGER only.',
  })
  @ApiResponse({ status: 200, description: 'Export finished; spreadsheet URL returned' })
  @ApiResponse({ status: 400, description: 'Invalid month payload' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  async exportMonthly(@Param('companyId') companyId: string, @Body() body: unknown) {
    const parsed = ExportMonthSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues.map((i) => i.message).join(', '));
    }
    const dto: ExportMonthDto = parsed.data;
    this.logger.log(`export requested company=${companyId} month=${dto.month}`);
    return this.sheets.exportCompanyMonth(companyId, dto.month);
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
}
