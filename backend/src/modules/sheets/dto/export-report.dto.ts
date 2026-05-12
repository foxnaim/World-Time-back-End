import { z } from 'zod';

/**
 * Body for POST /sheets/timesheet and POST /sheets/payroll.
 * Month format: "YYYY-MM" (zero-padded month 01..12).
 */
export const ExportReportSchema = z.object({
  companyId: z.string().min(1, 'companyId is required'),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'month must be formatted as YYYY-MM'),
});

export type ExportReportDto = z.infer<typeof ExportReportSchema>;
