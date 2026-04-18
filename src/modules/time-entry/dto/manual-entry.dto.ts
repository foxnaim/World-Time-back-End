import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Shape for POST /time-entries/manual — creating a retroactive closed entry
 * (e.g. freelancer forgot to hit "start" and logs the session by hand).
 *
 * Ownership of `projectId` is verified by TimeEntryService.
 */
export const ManualEntryDtoSchema = z
  .object({
    projectId: z.string().min(1),
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime(),
    note: z.string().max(5000).optional(),
  })
  .refine((d) => new Date(d.startedAt).getTime() < new Date(d.endedAt).getTime(), {
    message: 'startedAt must be before endedAt',
    path: ['endedAt'],
  });
export type ManualEntryDtoShape = z.infer<typeof ManualEntryDtoSchema>;

export class ManualEntryDto extends createZodDto(ManualEntryDtoSchema) {}
