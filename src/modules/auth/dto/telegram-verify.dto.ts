import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { TelegramVerifyRequestSchema } from '@worktime/types';

// Fallback schema if @worktime/types export is unavailable at build time;
// the exported TelegramVerifyRequestSchema from @worktime/types is preferred.
const Schema =
  (TelegramVerifyRequestSchema as z.ZodTypeAny | undefined) ??
  z.object({
    initData: z.string().min(1),
  });

export class TelegramVerifyDto extends createZodDto(Schema) {}
