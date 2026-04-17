import { IsEmail, IsUrl } from 'class-validator';

/**
 * Internal DTO for {@link NotificationService.sendAuthLink}. Reserved for a
 * future email-based magic-link login flow; the service implementation is
 * already wired so feature flags / callers can opt in without code churn.
 */
export class SendAuthLinkDto {
  @IsEmail()
  to!: string;

  @IsUrl({ require_tld: false, require_protocol: true })
  magicLink!: string;
}
