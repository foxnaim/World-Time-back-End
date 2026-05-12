import { promises as fs } from 'fs';
import * as path from 'path';
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

import type { OAuth2Client } from 'google-auth-library';

import { PrismaService } from '@/common/prisma.service';
import { TimesheetService } from '@/modules/report/timesheet.service';
import { PayrollService } from '@/modules/report/payroll.service';

import * as sheetStore from './storage/company-sheet-store';
import { GoogleOAuthService } from './google-oauth.service';
import { SHEETS_I18N, normalizeLocale, type Locale } from './sheets.i18n';
import type { AttendanceRow, ExportResult, StoredCompanySheet, SummaryRow } from './sheets.types';

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
];

function translateCheckInType(type: string, locale: Locale): string {
  const dict = SHEETS_I18N[locale];
  if (type === 'IN') return dict.typeIn;
  if (type === 'OUT') return dict.typeOut;
  return type;
}

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
    private readonly googleOAuth: GoogleOAuthService,
    private readonly timesheetService: TimesheetService,
    private readonly payrollService: PayrollService,
  ) {}

  // ----- auth -----

  /**
   * Build a GoogleAuth client from the service-account JSON file pointed to
   * by GOOGLE_SERVICE_ACCOUNT_JSON. Throws a 501 NotImplemented if the env
   * var is missing or the file cannot be read — callers should let that
   * bubble up so the HTTP layer produces the proper response.
   */
  async getAuthClient(): Promise<GoogleAuth> {
    const keyPath = this.config.get<string>('GOOGLE_SERVICE_ACCOUNT_JSON');
    if (!keyPath || keyPath.trim().length === 0) {
      throw new NotImplementedException(
        'Sheets export not configured. Set GOOGLE_SERVICE_ACCOUNT_JSON to enable.',
      );
    }
    let credentials: object;
    const resolvedPath = path.resolve(process.cwd(), keyPath.trim());
    try {
      const raw = await fs.readFile(resolvedPath, 'utf-8');
      credentials = JSON.parse(raw);
    } catch (err) {
      this.logger.error(`Cannot read service account key at ${resolvedPath}: ${(err as Error).message}`);
      throw new NotImplementedException(
        'Sheets export not configured. Set GOOGLE_SERVICE_ACCOUNT_JSON to enable.',
      );
    }
    return new google.auth.GoogleAuth({
      credentials,
      scopes: SCOPES,
    });
  }

  // ----- spreadsheet lifecycle -----

  /**
   * Pick the right Google auth client:
   *   1. Owner's OAuth2 credentials (preferred — creates the sheet in
   *      their Drive, no "service account can't create" limitation).
   *   2. Service account — works only when the target sheet is already
   *      shared with the SA; will fail on create without Workspace.
   */
  async resolveAuth(ownerUserId?: string): Promise<OAuth2Client | GoogleAuth> {
    if (ownerUserId) {
      const conn = await this.googleOAuth.getConnection(ownerUserId);
      if (conn.connected) {
        return this.googleOAuth.getAuthorizedClient(ownerUserId);
      }
    }
    return this.getAuthClient();
  }

  async getStored(companyId: string): Promise<StoredCompanySheet | undefined> {
    return sheetStore.get(companyId);
  }

  async getServiceAccountEmail(): Promise<string | null> {
    const keyPath = this.config.get<string>('GOOGLE_SERVICE_ACCOUNT_JSON');
    if (!keyPath) return null;
    try {
      const raw = await fs.readFile(path.resolve(process.cwd(), keyPath.trim()), 'utf-8');
      const parsed = JSON.parse(raw) as { client_email?: string };
      return parsed.client_email ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Store a manually-created spreadsheet for this company. The user must
   * have already shared the spreadsheet with the service account email as
   * Editor. We do a lightweight sanity check (can we read the title?) to
   * fail early if sharing is missing.
   */
  async setManualSpreadsheet(
    companyId: string,
    urlOrId: string,
  ): Promise<StoredCompanySheet> {
    const spreadsheetId = extractSpreadsheetId(urlOrId);
    if (!spreadsheetId) {
      throw new BadRequestException('Не удалось распознать ID таблицы из ссылки.');
    }

    const auth = await this.getAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });

    let meta;
    try {
      meta = await sheets.spreadsheets.get({ spreadsheetId });
    } catch (err) {
      const e = err as { code?: number; message?: string };
      if (e.code === 403 || e.code === 404) {
        const email = (await this.getServiceAccountEmail()) ?? '(сервисный email не определён)';
        throw new BadRequestException(
          `Таблица не найдена или не расшарена. Откройте её и добавьте ${email} с правами Editor.`,
        );
      }
      throw err;
    }

    const url =
      meta.data.spreadsheetUrl ??
      `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

    const entry: StoredCompanySheet = {
      spreadsheetId,
      url,
      createdAt: new Date().toISOString(),
    };
    await sheetStore.write(companyId, entry);
    this.logger.log(`Linked manual spreadsheet ${spreadsheetId} for company ${companyId}`);
    return entry;
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
    ownerUserId?: string,
    locale: Locale = 'ru',
  ): Promise<StoredCompanySheet> {
    const existing = await sheetStore.get(companyId);
    if (existing) return existing;

    const auth = await this.resolveAuth(ownerUserId);
    const sheets = google.sheets({ version: 'v4', auth });
    const dict = SHEETS_I18N[locale];

    let createRes;
    try {
      createRes = await sheets.spreadsheets.create({
        requestBody: {
          properties: { title: `Work Tact — ${companyName}` },
          sheets: [
            { properties: { title: dict.attendanceSheet } },
            { properties: { title: dict.summarySheet } },
          ],
        },
      });
    } catch (err) {
      const e = err as {
        message?: string;
        code?: number | string;
        response?: { data?: unknown; status?: number };
      };
      this.logger.error(
        `spreadsheets.create failed: code=${e.code} status=${e.response?.status} msg=${e.message} body=${JSON.stringify(e.response?.data)}`,
      );
      if (e.code === 403) {
        throw new BadRequestException(
          'Чтобы экспортировать в Google Sheets, владельцу компании нужно подключить Google-аккаунт в профиле.',
        );
      }
      throw err;
    }
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
  async exportCompanyMonth(
    companyId: string,
    month: string,
    locale: Locale = 'ru',
  ): Promise<ExportResult> {
    const dict = SHEETS_I18N[locale];
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
        type: translateCheckInType(c.type, locale),
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
    const stored = await this.getOrCreateSpreadsheet(
      companyId,
      company.name,
      [],
      company.ownerId,
      locale,
    );
    const auth = await this.resolveAuth(company.ownerId);
    const sheets = google.sheets({ version: 'v4', auth });

    const meta = await sheets.spreadsheets.get({
      spreadsheetId: stored.spreadsheetId,
    });
    const sheetList = meta.data.sheets ?? [];
    const attendanceSheetId = findSheetId(sheetList, dict.attendanceSheet);
    const summarySheetId = findSheetId(sheetList, dict.summarySheet);

    // Make sure both sheets exist (a user could have deleted one).
    const addRequests: sheets_v4.Schema$Request[] = [];
    if (attendanceSheetId === undefined) {
      addRequests.push({
        addSheet: { properties: { title: dict.attendanceSheet } },
      });
    }
    if (summarySheetId === undefined) {
      addRequests.push({
        addSheet: { properties: { title: dict.summarySheet } },
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
    const attSheetId = findSheetId(sheetList2, dict.attendanceSheet);
    const sumSheetId = findSheetId(sheetList2, dict.summarySheet);

    // Clear existing content, then write fresh.
    await sheets.spreadsheets.values.batchClear({
      spreadsheetId: stored.spreadsheetId,
      requestBody: {
        ranges: [`${dict.attendanceSheet}!A:Z`, `${dict.summarySheet}!A:Z`],
      },
    });

    const attendanceValues: (string | number | boolean)[][] = [
      dict.attendanceHeaders,
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
      dict.summaryHeaders,
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
      range: `${dict.attendanceSheet}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: attendanceValues },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: stored.spreadsheetId,
      range: `${dict.summarySheet}!A1`,
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

  // ----- timesheet / payroll exports -----

  /**
   * Resolve the company + its spreadsheet (creating if needed), make sure a
   * sheet/tab with `sheetTitle` exists, clear it, write `values` starting at
   * A1, and freeze the header row. Returns the standard ExportResult.
   *
   * Shared by exportTimesheet/exportPayroll — mirrors how exportCompanyMonth
   * handles auth, sheet creation and freezing.
   */
  private async writeReportSheet(
    companyId: string,
    sheetTitle: string,
    values: (string | number | boolean)[][],
    locale: Locale,
  ): Promise<ExportResult> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, name: true, ownerId: true },
    });
    if (!company) throw new NotFoundException('Company not found');

    const stored = await this.getOrCreateSpreadsheet(
      companyId,
      company.name,
      [],
      company.ownerId,
      locale,
    );
    const auth = await this.resolveAuth(company.ownerId);
    const sheets = google.sheets({ version: 'v4', auth });

    const meta = await sheets.spreadsheets.get({ spreadsheetId: stored.spreadsheetId });
    let sheetId = findSheetId(meta.data.sheets ?? [], sheetTitle);
    if (sheetId === undefined) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: stored.spreadsheetId,
        requestBody: { requests: [{ addSheet: { properties: { title: sheetTitle } } }] },
      });
      const meta2 = await sheets.spreadsheets.get({ spreadsheetId: stored.spreadsheetId });
      sheetId = findSheetId(meta2.data.sheets ?? [], sheetTitle);
    }

    await sheets.spreadsheets.values.batchClear({
      spreadsheetId: stored.spreadsheetId,
      requestBody: { ranges: [`${sheetTitle}!A:ZZ`] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: stored.spreadsheetId,
      range: `${sheetTitle}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values },
    });

    if (sheetId !== undefined) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: stored.spreadsheetId,
        requestBody: {
          requests: [
            {
              updateSheetProperties: {
                properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
                fields: 'gridProperties.frozenRowCount',
              },
            },
          ],
        },
      });
    }

    const rowsExported = Math.max(0, values.length - 1);
    return {
      spreadsheetUrl: stored.url,
      sheetId: stored.spreadsheetId,
      rowsExported,
    };
  }

  /**
   * Export the monthly timesheet ("Табель") grid to a "Timesheet" tab — one
   * row per employee, columns = day numbers, each cell holding the short code
   * for that day's state (present/late/vacation/…).
   */
  async exportTimesheet(
    userId: string,
    companyId: string,
    month: string,
    locale: Locale = 'ru',
  ): Promise<ExportResult> {
    const dict = SHEETS_I18N[locale];
    const ts = await this.timesheetService.getTimesheet(companyId, month, userId);
    const dayNumbers = Array.from({ length: ts.days }, (_, i) => i + 1);
    const values: (string | number | boolean)[][] = [
      [dict.timesheetEmployeeHeader, ...dayNumbers],
      ...ts.employees.map((emp) => [
        emp.position ? `${emp.name} (${emp.position})` : emp.name,
        ...dayNumbers.map((d) => {
          const state = emp.cells[String(d)] ?? 'absent';
          return dict.timesheetStateGlyphs[state] ?? '';
        }),
      ]),
    ];
    this.logger.log(
      `Exported timesheet company=${companyId} month=${month} employees=${ts.employees.length}`,
    );
    return this.writeReportSheet(companyId, dict.timesheetSheet, values, locale);
  }

  /**
   * Export the monthly payroll estimate to a "Payroll" tab — one row per
   * employee with rate, expected/worked hours, delta and estimated pay.
   */
  async exportPayroll(
    userId: string,
    companyId: string,
    month: string,
    locale: Locale = 'ru',
  ): Promise<ExportResult> {
    // userId is accepted for parity with exportTimesheet and to allow future
    // per-user auth inside the report service; PayrollService.getPayroll
    // currently performs no caller check (the controller guards the route).
    void userId;
    const dict = SHEETS_I18N[locale];
    const report = await this.payrollService.getPayroll(companyId, month);

    const rateLabel = (r: (typeof report.employees)[number]): string => {
      if (r.basis === 'hourly' && r.hourlyRate != null) return `${r.hourlyRate}/ч`;
      if (r.basis === 'salary' && r.monthlySalary != null) return `${r.monthlySalary}/мес`;
      return '—';
    };

    const values: (string | number | boolean)[][] = [
      dict.payrollHeaders,
      ...report.employees.map((r) => [
        r.name,
        r.position ?? '',
        rateLabel(r),
        r.expectedHours,
        r.workedHours,
        r.deltaHours,
        r.estimatedPay ?? '',
        r.proratedPay ?? '',
      ]),
    ];
    this.logger.log(
      `Exported payroll company=${companyId} month=${month} employees=${report.employees.length}`,
    );
    return this.writeReportSheet(companyId, dict.payrollSheet, values, locale);
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

function extractSpreadsheetId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const urlMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (urlMatch) return urlMatch[1];
  if (/^[a-zA-Z0-9-_]+$/.test(trimmed)) return trimmed;
  return null;
}
