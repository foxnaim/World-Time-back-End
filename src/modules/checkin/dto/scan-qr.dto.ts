import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { ScanQrDtoSchema } from '@tact/types';

/**
 * The canonical ScanQrDto lives in @tact/types so the Telegram bot and
 * the web clients can share the exact same validation contract. We fall back
 * to a local schema only if the export is unavailable at build time.
 */
const Schema =
  (ScanQrDtoSchema as z.ZodTypeAny | undefined) ??
  z.object({
    token: z.string().min(1, 'token is required'),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
  });

export class ScanQrDto extends createZodDto(Schema) {}
