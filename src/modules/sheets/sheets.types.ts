/**
 * Sheet row types for Google Sheets export.
 *
 * These shapes are flattened tuples ready to be turned into rows
 * (string[][]) for the Google Sheets API. Keep field order stable —
 * it matches the header rows emitted in SheetsService.
 */

export interface AttendanceRow {
  /** ISO date (YYYY-MM-DD) in company timezone */
  date: string;
  employeeName: string;
  position: string;
  /** "IN" | "OUT" */
  type: string;
  /** HH:mm local time */
  time: string;
  isLate: boolean;
  lateMinutes: number;
  latitude: number | null;
  longitude: number | null;
}

export interface SummaryRow {
  employeeName: string;
  position: string;
  workedHours: number;
  lateCount: number;
  totalLateMinutes: number;
  overtimeHours: number;
  monthlySalary: number;
  /** Optional — included only if we can compute a final payout. */
  finalPayout?: number;
}

export interface StoredCompanySheet {
  spreadsheetId: string;
  url: string;
  createdAt: string;
}

export interface CompanySheetStoreFile {
  [companyId: string]: StoredCompanySheet;
}

export interface ExportResult {
  spreadsheetUrl: string;
  sheetId: string;
  rowsExported: number;
}
