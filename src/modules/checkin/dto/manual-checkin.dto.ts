import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Admin-initiated check-in creation payload. Used by OWNER/MANAGER to record
 * an IN/OUT on behalf of an employee — e.g. when the office QR screen was
 * offline, or to correct a missed punch.
 *
 * `timestamp` is optional; if omitted, the server uses `now()`. `reason`
 * documents why the manual entry was needed. The current CheckIn schema has
 * no `note` column, so for MVP we accept `reason` but only surface it through
 * a structured log line — see CheckinService.manualCreate.
 */
export const ManualCheckinSchema = z.object({
  employeeId: z.string().min(1, 'employeeId is required'),
  type: z.enum(['IN', 'OUT']),
  timestamp: z.string().datetime().optional(),
  reason: z.string().max(500).optional(),
});

export type ManualCheckin = z.infer<typeof ManualCheckinSchema>;

export class ManualCheckinDto extends createZodDto(ManualCheckinSchema) {}
