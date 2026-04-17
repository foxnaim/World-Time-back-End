import { IsEmail, IsString, IsUrl, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * Internal DTO for {@link NotificationService.sendMonthlyReportReady}. Fired
 * after a monthly Google Sheets export completes, so the company owner gets
 * a link even if they weren't watching the bot.
 */
export class SendMonthlyReportReadyDto {
  @IsEmail()
  to!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  companyName!: string;

  /** ISO year-month, e.g. "2026-04". */
  @Matches(/^\d{4}-\d{2}$/u, { message: 'month must be YYYY-MM' })
  month!: string;

  @IsUrl({ require_tld: false, require_protocol: true })
  spreadsheetUrl!: string;
}
