import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { RefreshRequestSchema } from '@tact/types';

const Schema =
  (RefreshRequestSchema as z.ZodTypeAny | undefined) ??
  z.object({
    refreshToken: z.string().min(1),
  });

export class RefreshDto extends createZodDto(Schema) {}
