import { z } from 'zod';

/**
 * Body for POST /sheets/export/company/:companyId/monthly
 * Month format: "YYYY-MM" (zero-padded month 01..12).
 */
export const ExportMonthSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'month must be formatted as YYYY-MM'),
});

export type ExportMonthDto = z.infer<typeof ExportMonthSchema>;
