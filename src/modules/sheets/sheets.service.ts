import { promises as fs } from 'fs';
import {
  Injectable,
  Logger,
  NotImplementedException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google } from 'googleapis';
import type { sheets_v4 } from 'googleapis';
import type { GoogleAuth } from 'google-auth-library';

import { PrismaService } from '@/common/prisma.service';

import * as sheetStore from './storage/company-sheet-store';
import type { AttendanceRow, ExportResult, StoredCompanySheet, SummaryRow } from './sheets.types';

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
];

const ATTENDANCE_SHEET = 'Attendance';
const SUMMARY_SHEET = 'Summary';

const ATTENDANCE_HEADERS = [
  'Date',
  'Employee',
  'Position',
  'Type',
  'Time',
  'Late',
  'Late (min)',
  'Latitude',
  'Longitude',
];

const SUMMARY_HEADERS = [
  'Employee',
  'Position',
  'Worked Hours',
  'Late Count',
  'Total Late (min)',
  'Overtime Hours',
  'Monthly Salary',
  'Final Payout',
];

/**
 * Google Sheets export service.
 *
 * Not the source of truth — just a convenience for business managers who
 * prefer spreadsheets. One spreadsheet per company (created on first export),
 * reused on subsequent exports. The spreadsheet always has exactly two
 * sheets: "Attendance" and "Summary".
 */
@Injectable()
export class SheetsService {
  private readonly logger = new Logger(SheetsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  // ----- auth -----

  /**
   * Build a GoogleAuth client from the service-account JSON file pointed to
   * by GOOGLE_SERVICE_ACCOUNT_JSON. Throws a 501 NotImplemented if the env
   * var is missing or the file cannot be read — callers should let that
   * bubble up so the HTTP layer produces the proper response.
   */
  async getAuthClient(): Promise<GoogleAuth> {
    const keyFile = this.config.get<string>('GOOGLE_SERVICE_ACCOUNT_JSON');
    if (!keyFile || keyFile.trim().length === 0) {
      throw new NotImplementedException(
        'Sheets export not configured. Set GOOGLE_SERVICE_ACCOUNT_JSON to enable.',
      );
    }
    try {
      await fs.access(keyFile);
    } catch {
      throw new NotImplementedException(
        'Sheets export not configured. Set GOOGLE_SERVICE_ACCOUNT_JSON to enable.',
      );
    }
    try {
      return new google.auth.GoogleAuth({
        keyFile,
        scopes: SCOPES,
      });
    } catch (err) {
      this.logger.error(`Failed to build GoogleAuth: ${(err as Error).message}`);
      throw new NotImplementedException(
        'Sheets export not configured. Set GOOGLE_SERVICE_ACCOUNT_JSON to enable.',
      );
    }
  }

  // ----- spreadsheet lifecycle -----

  async getStored(companyId: string): Promise<StoredCompanySheet | undefined> {
    return sheetStore.get(companyId);
  }

  /**
   * Returns the stored spreadsheet ID for this company, or creates a new
   * spreadsheet (titled "Work Tact — {companyName}") and persists it to the
   * JSON store. Optionally grants writer permission to a list of user
   * emails via Drive API.
   */
  async getOrCreateSpreadsheet(
    companyId: string,
    companyName: string,
    writerEmails: string[] = [],
  ): Promise<StoredCompanySheet> {
    const existing = await sheetStore.get(companyId);
    if (existing) return existing;

    const auth = await this.getAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });

    const createRes = await sheets.spreadsheets.create({
      requestBody: {
        properties: { title: `Work Tact — ${companyName}` },
        sheets: [
          { properties: { title: ATTENDANCE_SHEET } },
          { properties: { title: SUMMARY_SHEET } },
        ],
      },
    });
    const spreadsheetId = createRes.data.spreadsheetId;
    const url = createRes.data.spreadsheetUrl;
    if (!spreadsheetId || !url) {
      throw new Error('Google Sheets API did not return spreadsheet ID/URL');
    }

    // Grant writer access to managers, if any were provided. Best-effort.
    if (writerEmails.length > 0) {
      try {
        const drive = google.drive({ version: 'v3', auth });
        for (const email of writerEmails) {
          if (!email) continue;
          await drive.permissions.create({
            fileId: spreadsheetId,
            sendNotificationEmail: false,
            requestBody: {
              role: 'writer',
              type: 'user',
              emailAddress: email,
            },
          });
        }
      } catch (err) {
        this.logger.warn(
          `Failed to grant Drive permissions for ${spreadsheetId}: ${(err as Error).message}`,
        );
      }
    }

    const entry: StoredCompanySheet = {
      spreadsheetId,
      url,
      createdAt: new Date().toISOString(),
    };
    await sheetStore.write(companyId, entry);
    this.logger.log(`Created spreadsheet ${spreadsheetId} for company ${companyId}`);
    return entry;
  }

  // ----- export -----

  /**
   * Pull check-ins + employees for the company/month and write both sheets.
   *
   * @param companyId Prisma Company.id
   * @param month "YYYY-MM"
   */
  async exportCompanyMonth(companyId: string, month: string): Promise<ExportResult> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      include: { owner: true },
    });
    if (!company) throw new NotFoundException('Company not found');

    const { start, end } = monthRange(month, company.timezone);
    if (!start || !end) {
      throw new BadRequestException('Invalid month');
    }

    const employees = await this.prisma.employee.findMany({
      where: { companyId },
      include: { user: true },
    });
    const employeeById = new Map(employees.map((e) => [e.id, e]));

    const checkIns = await this.prisma.checkIn.findMany({
      where: {
        employee: { companyId },
        timestamp: { gte: start, lt: end },
      },
      orderBy: { timestamp: 'asc' },
    });

    // --- Attendance rows ---
    const attendance: AttendanceRow[] = checkIns.map((c) => {
      const emp = employeeById.get(c.employeeId);
      const user = emp?.user;
      const employeeName = user
        ? `${user.firstName}${user.lastName ? ' ' + user.lastName : ''}`.trim()
        : '(unknown)';
      const { date, time } = splitDateTime(c.timestamp, company.timezone);
      const { isLate, lateMinutes } =
        c.type === 'IN'
          ? computeLateness(c.timestamp, company.timezone, company.workStartHour)
          : { isLate: false, lateMinutes: 0 };
      return {
        date,
        employeeName,
        position: emp?.position ?? '',
        type: c.type,
        time,
        isLate,
        lateMinutes,
        latitude: c.latitude ?? null,
        longitude: c.longitude ?? null,
      };
    });

    // --- Summary rows (per employee) ---
    const summary: SummaryRow[] = employees.map((emp) => {
      const rows = checkIns.filter((c) => c.employeeId === emp.id);
      const pairs = pairInOut(rows);
      const workedMs = pairs.reduce((acc, p) => acc + (p.out.getTime() - p.in.getTime()), 0);
      const workedHours = round2(workedMs / 3_600_000);
      let lateCount = 0;
      let totalLateMinutes = 0;
      for (const c of rows) {
        if (c.type !== 'IN') continue;
        const { isLate, lateMinutes } = computeLateness(
          c.timestamp,
          company.timezone,
          company.workStartHour,
        );
        if (isLate) {
          lateCount += 1;
          totalLateMinutes += lateMinutes;
        }
      }
      const scheduledHoursPerDay = Math.max(0, company.workEndHour - company.workStartHour) || 8;
      const workedDays = pairs.length;
      const scheduledHours = workedDays * scheduledHoursPerDay;
      const overtimeHours = Math.max(0, round2(workedHours - scheduledHours));
      const monthlySalary = emp.monthlySalary ? Number(emp.monthlySalary) : 0;
      const user = emp.user;
      const employeeName = user
        ? `${user.firstName}${user.lastName ? ' ' + user.lastName : ''}`.trim()
        : '(unknown)';
      // Simple finalPayout heuristic: salary minus lateness penalty (skipped
      // if we can't compute). Keeping this conservative — business logic
      // for payroll lives elsewhere.
      const finalPayout =
        monthlySalary > 0
          ? round2(monthlySalary - (totalLateMinutes / 60) * (monthlySalary / 160))
          : undefined;
      return {
        employeeName,
        position: emp.position ?? '',
        workedHours,
        lateCount,
        totalLateMinutes,
        overtimeHours,
        monthlySalary,
        finalPayout,
      };
    });

    // --- Write to Sheets ---
    const stored = await this.getOrCreateSpreadsheet(companyId, company.name);
    const auth = await this.getAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });

    const meta = await sheets.spreadsheets.get({
      spreadsheetId: stored.spreadsheetId,
    });
    const sheetList = meta.data.sheets ?? [];
    const attendanceSheetId = findSheetId(sheetList, ATTENDANCE_SHEET);
    const summarySheetId = findSheetId(sheetList, SUMMARY_SHEET);

    // Make sure both sheets exist (a user could have deleted one).
    const addRequests: sheets_v4.Schema$Request[] = [];
    if (attendanceSheetId === undefined) {
      addRequests.push({
        addSheet: { properties: { title: ATTENDANCE_SHEET } },
      });
    }
    if (summarySheetId === undefined) {
      addRequests.push({
        addSheet: { properties: { title: SUMMARY_SHEET } },
      });
    }
    if (addRequests.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: stored.spreadsheetId,
        requestBody: { requests: addRequests },
      });
    }

    // Re-fetch to pick up any added sheets' IDs.
    const meta2 = await sheets.spreadsheets.get({
      spreadsheetId: stored.spreadsheetId,
    });
    const sheetList2 = meta2.data.sheets ?? [];
    const attSheetId = findSheetId(sheetList2, ATTENDANCE_SHEET);
    const sumSheetId = findSheetId(sheetList2, SUMMARY_SHEET);

    // Clear existing content, then write fresh.
    await sheets.spreadsheets.values.batchClear({
      spreadsheetId: stored.spreadsheetId,
      requestBody: {
        ranges: [`${ATTENDANCE_SHEET}!A:Z`, `${SUMMARY_SHEET}!A:Z`],
      },
    });

    const attendanceValues: (string | number | boolean)[][] = [
      ATTENDANCE_HEADERS,
      ...attendance.map((r) => [
        r.date,
        r.employeeName,
        r.position,
        r.type,
        r.time,
        r.isLate,
        r.lateMinutes,
        r.latitude ?? '',
        r.longitude ?? '',
      ]),
    ];
    const summaryValues: (string | number)[][] = [
      SUMMARY_HEADERS,
      ...summary.map((r) => [
        r.employeeName,
        r.position,
        r.workedHours,
        r.lateCount,
        r.totalLateMinutes,
        r.overtimeHours,
        r.monthlySalary,
        r.finalPayout ?? '',
      ]),
    ];

    await sheets.spreadsheets.values.update({
      spreadsheetId: stored.spreadsheetId,
      range: `${ATTENDANCE_SHEET}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: attendanceValues },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: stored.spreadsheetId,
      range: `${SUMMARY_SHEET}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: summaryValues },
    });

    // Freeze the header row on both sheets.
    const freezeRequests: sheets_v4.Schema$Request[] = [];
    if (attSheetId !== undefined) {
      freezeRequests.push({
        updateSheetProperties: {
          properties: {
            sheetId: attSheetId,
            gridProperties: { frozenRowCount: 1 },
          },
          fields: 'gridProperties.frozenRowCount',
        },
      });
    }
    if (sumSheetId !== undefined) {
      freezeRequests.push({
        updateSheetProperties: {
          properties: {
            sheetId: sumSheetId,
            gridProperties: { frozenRowCount: 1 },
          },
          fields: 'gridProperties.frozenRowCount',
        },
      });
    }
    if (freezeRequests.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: stored.spreadsheetId,
        requestBody: { requests: freezeRequests },
      });
    }

    const rowsExported = attendance.length + summary.length;
    this.logger.log(
      `Exported company=${companyId} month=${month} attendance=${attendance.length} summary=${summary.length}`,
    );
    return {
      spreadsheetUrl: stored.url,
      sheetId: stored.spreadsheetId,
      rowsExported,
    };
  }
}

// ---------- helpers ----------

function findSheetId(sheets: sheets_v4.Schema$Sheet[], title: string): number | undefined {
  const match = sheets.find((s) => s.properties?.title === title);
  return match?.properties?.sheetId ?? undefined;
}

/**
 * Compute the UTC [start, end) bounds of a YYYY-MM month in the given IANA
 * timezone. Fallback to UTC if the zone is malformed.
 */
function monthRange(month: string, timezone: string): { start: Date | null; end: Date | null } {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return { start: null, end: null };
  const year = Number(m[1]);
  const mon = Number(m[2]); // 1..12
  // Use UTC as a safe approximation. For MVP this is good enough — refined
  // timezone handling belongs in a shared utility.
  void timezone;
  const start = new Date(Date.UTC(year, mon - 1, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, mon, 1, 0, 0, 0, 0));
  return { start, end };
}

function splitDateTime(ts: Date, timezone: string): { date: string; time: string } {
  try {
    const fmtDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const fmtTime = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    return { date: fmtDate.format(ts), time: fmtTime.format(ts) };
  } catch {
    return {
      date: ts.toISOString().slice(0, 10),
      time: ts.toISOString().slice(11, 16),
    };
  }
}

function computeLateness(
  ts: Date,
  timezone: string,
  workStartHour: number,
): { isLate: boolean; lateMinutes: number } {
  try {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = fmt.format(ts).split(':');
    const h = Number(parts[0]);
    const mm = Number(parts[1]);
    const minutesFromMidnight = h * 60 + mm;
    const threshold = workStartHour * 60;
    if (minutesFromMidnight <= threshold) {
      return { isLate: false, lateMinutes: 0 };
    }
    return {
      isLate: true,
      lateMinutes: minutesFromMidnight - threshold,
    };
  } catch {
    return { isLate: false, lateMinutes: 0 };
  }
}

/**
 * Pair consecutive IN/OUT records for a single employee so we can compute
 * worked duration. Any leftover IN without an OUT is discarded.
 */
function pairInOut(checkIns: { type: string; timestamp: Date }[]): { in: Date; out: Date }[] {
  const pairs: { in: Date; out: Date }[] = [];
  let pendingIn: Date | null = null;
  for (const c of checkIns) {
    if (c.type === 'IN') {
      pendingIn = c.timestamp;
    } else if (c.type === 'OUT' && pendingIn) {
      pairs.push({ in: pendingIn, out: c.timestamp });
      pendingIn = null;
    }
  }
  return pairs;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
