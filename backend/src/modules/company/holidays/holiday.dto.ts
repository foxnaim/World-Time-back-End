import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Payload to create a single company holiday (non-working day).
 *
 * `date` is a plain calendar date (`YYYY-MM-DD`); the service stores it at UTC
 * midnight of that date so the `@@unique([companyId, date])` constraint and the
 * `@db.Date` column behave deterministically regardless of server timezone.
 */
export const CreateHolidaySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be in YYYY-MM-DD format'),
  name: z.string().trim().min(1, 'name is required').max(120),
});

export type CreateHoliday = z.infer<typeof CreateHolidaySchema>;

export class CreateHolidayDto extends createZodDto(CreateHolidaySchema) {}
