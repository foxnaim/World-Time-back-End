import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { TelegramVerifyRequestSchema } from '@tact/types';

// Fallback schema if @tact/types export is unavailable at build time;
// the exported TelegramVerifyRequestSchema from @tact/types is preferred.
const Schema =
  (TelegramVerifyRequestSchema as z.ZodTypeAny | undefined) ??
  z.object({
    initData: z.string().min(1),
  });

export class TelegramVerifyDto extends createZodDto(Schema) {}
