import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Bot-issued one-time code login.
 *
 * The user never learns their internal `userId` — they only see the
 * 6-digit code printed in the bot chat. The server looks up the code
 * in its OTC store to derive `telegramId`, then finds the User by
 * telegramId.
 */
const BotLoginSchema = z.object({
  oneTimeCode: z.string().regex(/^\d{6}$/, 'oneTimeCode must be 6 digits'),
});

export class BotLoginDto extends createZodDto(BotLoginSchema) {}
