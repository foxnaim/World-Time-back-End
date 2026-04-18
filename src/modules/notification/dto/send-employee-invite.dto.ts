import { IsEmail, IsOptional, IsString, IsUrl, MaxLength, MinLength } from 'class-validator';

/**
 * Internal DTO for {@link NotificationService.sendEmployeeInvite}. This is not
 * an HTTP body — we use class-validator anyway so callers (other services) get
 * a loud failure if they forget a field.
 */
export class SendEmployeeInviteDto {
  @IsEmail()
  to!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  companyName!: string;

  @IsUrl({ require_tld: false, require_protocol: true })
  inviteLink!: string;

  /** Bot username without the leading @, e.g. "worktact_bot". Optional. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  telegramBotUsername?: string;
}
