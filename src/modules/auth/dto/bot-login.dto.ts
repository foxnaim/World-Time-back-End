import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const BotLoginSchema = z.object({
  userId: z.string().cuid(),
  oneTimeCode: z.string().regex(/^\d{6}$/, 'oneTimeCode must be 6 digits'),
});

export class BotLoginDto extends createZodDto(BotLoginSchema) {}
