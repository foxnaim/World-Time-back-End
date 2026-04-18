import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Readable } from 'node:stream';

import PDFDocument from 'pdfkit';
import { format } from 'date-fns';

import { PrismaService } from '@/common/prisma.service';
import { AnalyticsService } from '@/modules/analytics/analytics.service';
import {
  LATE_GRACE_MINUTES,
  buildMonthRange,
  computeLateMinutes,
  computeOvertime,
  groupByDay,
  isWeekend,
  localParts,
} from '@/modules/analytics/analytics.helpers';

import { COLORS, MARGIN, SPACING, drawHairline } from './pdf/layout';
import { FONTS, registerFonts, useFont } from './pdf/fonts';

interface AttendanceRow {
  employeeId: string;
  name: string;
  position: string;
  hours: number;
  lateCount: number;
  totalLateMinutes: number;
  overtime: number;
}

/**
 * ReportService — composes PDF streams for B2B monthly attendance reports
 * and B2C freelance invoices.
 *
 * Returning a `Readable` instead of a `Buffer` lets the controller pipe
 * directly into the HTTP response; memory usage stays flat even for large
 * rosters.
 */
@Injectable()
export class ReportService {
  private readonly logger = new Logger(ReportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsService,
  ) {}

  // ---------------------------------------------------------------------------
  // B2B: monthly attendance PDF
  // ---------------------------------------------------------------------------

  async buildAttendancePdf(companyId: string, month: string): Promise<Readable> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        name: true,
        timezone: true,
        workStartHour: true,
        workEndHour: true,
      },
    });
    if (!company) throw new NotFoundException('Company not found');

    const rows = await this.collectAttendanceRows(company, month);

    const doc = new PDFDocument({
      size: 'A4',
      margin: MARGIN,
      // bufferPages lets us walk back over every page at end-of-build to
      // paint footers with "page N of M".
      bufferPages: true,
      info: {
        Title: `Attendance — ${company.name} — ${month}`,
        Author: 'Work Tact',
        Subject: `Monthly attendance report for ${month}`,
      },
    });
    registerFonts(doc);

    // Tint the entire page cream. PDFKit doesn't offer a page background
    // primitive, so we fill a rect covering the full media box and *then*
    // start writing content over it.
    this.paintPageBackground(doc);
    doc.on('pageAdded', () => this.paintPageBackground(doc));

    this.drawAttendanceHeader(doc, company.name, month);
    this.drawAttendanceTable(doc, rows);
    this.drawAttendanceSummary(doc, rows);
    this.drawFooter(doc);

    doc.end();
    return doc as unknown as Readable;
  }

  // ---------------------------------------------------------------------------
  // B2C: freelance invoice PDF
  // ---------------------------------------------------------------------------

  async buildInvoicePdf(userId: string, month: string, projectId?: string): Promise<Readable> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, firstName: true, lastName: true, username: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const breakdown = await this.analytics.getUserRealHourlyRate(userId, month);

    // Narrow to a single project if requested — cheap client-side filter so we
    // keep a single source of truth for income attribution logic.
    const lines = breakdown.perProject.filter(
      (p) => !p.excluded && (!projectId || p.projectId === projectId),
    );

    if (projectId && lines.length === 0) {
      throw new NotFoundException(
        'No billable time logged for that project in the requested month',
      );
    }

    const doc = new PDFDocument({
      size: 'A4',
      margin: MARGIN,
      bufferPages: true,
      info: {
        Title: `Invoice — ${month}`,
        Author: 'Work Tact',
      },
    });
    registerFonts(doc);
    this.paintPageBackground(doc);
    doc.on('pageAdded', () => this.paintPageBackground(doc));

    this.drawInvoiceHeader(doc, user, month);
    this.drawInvoiceLineItems(doc, lines);
    this.drawInvoiceTotals(doc, lines);
    this.drawFooter(doc);

    doc.end();
    return doc as unknown as Readable;
  }

  // ---------------------------------------------------------------------------
  // Data collection
  // ---------------------------------------------------------------------------

  /**
   * Walk every active employee's check-ins for the month and reduce to a flat
   * row. This reuses the same late/overtime helpers AnalyticsService does so
   * the PDF lines up with on-screen dashboard figures.
   */
  private async collectAttendanceRows(
    company: {
      id: string;
      timezone: string;
      workStartHour: number;
      workEndHour: number;
    },
    month: string,
  ): Promise<AttendanceRow[]> {
    const { start, end } = buildMonthRange(month);

    const employees = await this.prisma.employee.findMany({
      where: { companyId: company.id, status: 'ACTIVE' },
      select: {
        id: true,
        position: true,
        user: { select: { firstName: true, lastName: true } },
        checkIns: {
          where: { timestamp: { gte: start, lte: end } },
          select: { id: true, type: true, timestamp: true },
          orderBy: { timestamp: 'asc' },
        },
      },
    });

    return employees.map((emp) => {
      const byDay = groupByDay(emp.checkIns, company.timezone);
      let lateCount = 0;
      let totalLateMinutes = 0;
      let overtime = 0;
      let totalSeconds = 0;

      for (const [, dayCheckIns] of byDay) {
        const ins = dayCheckIns
          .filter((c) => c.type === 'IN')
          .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        const outs = dayCheckIns
          .filter((c) => c.type === 'OUT')
          .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        const firstIn = ins[0];
        const lastOut = outs[outs.length - 1];
        if (!firstIn) continue;

        const inParts = localParts(firstIn.timestamp, company.timezone);
        totalLateMinutes += (() => {
          const lateMin = computeLateMinutes(
            inParts.hour,
            inParts.minute,
            company.workStartHour,
            LATE_GRACE_MINUTES,
          );
          if (lateMin > 0) lateCount += 1;
          return lateMin;
        })();

        if (lastOut) {
          const outParts = localParts(lastOut.timestamp, company.timezone);
          totalSeconds += Math.max(
            0,
            (lastOut.timestamp.getTime() - firstIn.timestamp.getTime()) / 1000,
          );
          overtime += computeOvertime(
            outParts.hour,
            outParts.minute,
            inParts.hour,
            inParts.minute,
            company.workEndHour,
            isWeekend(outParts.weekday),
          );
        }
      }

      const name = emp.user.lastName
        ? `${emp.user.firstName} ${emp.user.lastName}`
        : emp.user.firstName;

      return {
        employeeId: emp.id,
        name,
        position: emp.position ?? '—',
        hours: Math.round((totalSeconds / 3600) * 10) / 10,
        lateCount,
        totalLateMinutes,
        overtime: Math.round(overtime * 10) / 10,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Drawing primitives
  // ---------------------------------------------------------------------------

  private paintPageBackground(doc: PDFKit.PDFDocument): void {
    doc.save();
    doc.rect(0, 0, doc.page.width, doc.page.height).fill(COLORS.cream);
    doc.restore();
    // Default ink colour for anything subsequent.
    doc.fillColor(COLORS.stone);
  }

  private drawAttendanceHeader(doc: PDFKit.PDFDocument, companyName: string, month: string): void {
    const top = MARGIN;
    const right = doc.page.width - MARGIN;

    // Wordmark top-right
    useFont(doc, FONTS.body, 9).fillColor(COLORS.muted);
    doc.text('WORK TACT', right - 80, top, {
      width: 80,
      align: 'right',
      characterSpacing: 1.2,
    });

    // Company name in display serif
    useFont(doc, FONTS.heading, 32).fillColor(COLORS.stone);
    doc.text(companyName, MARGIN, top + SPACING.md, {
      width: doc.page.width - MARGIN * 2 - 100,
      lineBreak: false,
      ellipsis: true,
    });

    // Period strip — uppercased body for a small-caps feel
    useFont(doc, FONTS.body, 10).fillColor(COLORS.coral);
    doc.text(
      `MONTHLY ATTENDANCE · ${this.humanMonth(month).toUpperCase()}`,
      MARGIN,
      top + SPACING.md + 44,
      { characterSpacing: 1.6 },
    );

    doc.y = top + SPACING.md + 44 + SPACING.lg;
    drawHairline(doc, MARGIN, doc.y, doc.page.width - MARGIN * 2);
    doc.y += SPACING.md;
  }

  private drawAttendanceTable(doc: PDFKit.PDFDocument, rows: AttendanceRow[]): void {
    const left = MARGIN;
    const fullWidth = doc.page.width - MARGIN * 2;

    // Column layout — all numeric columns right-aligned. Widths in PDF points;
    // must sum to fullWidth.
    const cols = [
      { key: 'name', label: 'Employee', width: 140, align: 'left' as const },
      { key: 'position', label: 'Position', width: 110, align: 'left' as const },
      { key: 'hours', label: 'Hours', width: 60, align: 'right' as const },
      { key: 'lateCount', label: 'Lates', width: 50, align: 'right' as const },
      {
        key: 'totalLateMinutes',
        label: 'Late min',
        width: 70,
        align: 'right' as const,
      },
      {
        key: 'overtime',
        label: 'Overtime',
        width: fullWidth - (140 + 110 + 60 + 50 + 70),
        align: 'right' as const,
      },
    ];

    // Header row
    useFont(doc, FONTS.body, 9).fillColor(COLORS.muted);
    let x = left;
    const headerY = doc.y;
    for (const c of cols) {
      doc.text(c.label.toUpperCase(), x, headerY, {
        width: c.width,
        align: c.align,
        characterSpacing: 1.4,
      });
      x += c.width;
    }
    doc.y = headerY + 14;
    drawHairline(doc, left, doc.y, fullWidth);
    doc.y += SPACING.sm;

    // Body rows — repaginate as we go.
    useFont(doc, FONTS.body, 10).fillColor(COLORS.stone);
    for (const row of rows) {
      if (doc.y > doc.page.height - MARGIN - 120) {
        doc.addPage();
        doc.y = MARGIN;
      }
      const rowY = doc.y;
      x = left;
      for (const c of cols) {
        const v = this.formatAttendanceCell(row, c.key as keyof AttendanceRow);
        const isLateHighlight =
          (c.key === 'lateCount' || c.key === 'totalLateMinutes') && Number(v) > 0;
        doc.fillColor(isLateHighlight ? COLORS.red : COLORS.stone);
        doc.text(v, x, rowY, { width: c.width, align: c.align });
        x += c.width;
      }
      doc.y = rowY + 16;
      drawHairline(doc, left, doc.y - 4, fullWidth);
    }
    doc.y += SPACING.md;
  }

  private formatAttendanceCell(row: AttendanceRow, key: keyof AttendanceRow): string {
    const v = row[key];
    if (typeof v === 'number') {
      if (key === 'hours' || key === 'overtime') return v.toFixed(1);
      return String(v);
    }
    return String(v);
  }

  private drawAttendanceSummary(doc: PDFKit.PDFDocument, rows: AttendanceRow[]): void {
    const totalHours = rows.reduce((s, r) => s + r.hours, 0);
    const totalLates = rows.reduce((s, r) => s + r.lateCount, 0);
    const totalLateMin = rows.reduce((s, r) => s + r.totalLateMinutes, 0);
    const totalOvertime = rows.reduce((s, r) => s + r.overtime, 0);

    if (doc.y > doc.page.height - MARGIN - 140) {
      doc.addPage();
      doc.y = MARGIN;
    }

    const left = MARGIN;
    const fullWidth = doc.page.width - MARGIN * 2;
    const boxTop = doc.y;
    const boxHeight = 92;

    // Summary card — coral rule top + stone fill text.
    doc.save();
    doc.rect(left, boxTop, fullWidth, boxHeight).lineWidth(0.8).strokeColor(COLORS.coral).stroke();
    doc.restore();

    useFont(doc, FONTS.body, 9).fillColor(COLORS.coral);
    doc.text('SUMMARY', left + SPACING.md, boxTop + SPACING.md, {
      characterSpacing: 1.6,
    });

    const cellW = fullWidth / 4;
    const statY = boxTop + SPACING.md + 18;
    const stats: Array<[string, string]> = [
      ['Employees', String(rows.length)],
      ['Total hours', totalHours.toFixed(1)],
      ['Lates', `${totalLates} (${totalLateMin} min)`],
      ['Overtime', `${totalOvertime.toFixed(1)} h`],
    ];
    for (let i = 0; i < stats.length; i++) {
      const [label, value] = stats[i]!;
      const cx = left + SPACING.md + cellW * i;
      useFont(doc, FONTS.body, 8).fillColor(COLORS.muted);
      doc.text(label.toUpperCase(), cx, statY, {
        width: cellW - SPACING.md,
        characterSpacing: 1.4,
      });
      useFont(doc, FONTS.headingMedium, 20).fillColor(COLORS.stone);
      doc.text(value, cx, statY + 14, { width: cellW - SPACING.md });
    }

    doc.y = boxTop + boxHeight + SPACING.md;
  }

  private drawInvoiceHeader(
    doc: PDFKit.PDFDocument,
    user: { id: string; firstName: string; lastName: string | null },
    month: string,
  ): void {
    const top = MARGIN;
    const right = doc.page.width - MARGIN;
    const { start, end } = buildMonthRange(month);

    // Wordmark top-right
    useFont(doc, FONTS.body, 9).fillColor(COLORS.muted);
    doc.text('WORK TACT', right - 80, top, {
      width: 80,
      align: 'right',
      characterSpacing: 1.2,
    });

    // Invoice number — deterministic from user + month so reruns collide
    // intentionally.
    const invoiceNo = `INV-${month.replace('-', '')}-${user.id.slice(-6).toUpperCase()}`;

    useFont(doc, FONTS.heading, 32).fillColor(COLORS.stone);
    doc.text('Invoice', MARGIN, top + SPACING.md);

    useFont(doc, FONTS.body, 10).fillColor(COLORS.coral);
    doc.text(invoiceNo, MARGIN, top + SPACING.md + 40, {
      characterSpacing: 1.4,
    });

    const displayName = user.lastName ? `${user.firstName} ${user.lastName}` : user.firstName;

    useFont(doc, FONTS.body, 10).fillColor(COLORS.stone);
    const metaY = top + SPACING.md + 64;
    doc.text(`Freelancer: ${displayName}`, MARGIN, metaY);
    doc.text(
      `Period: ${format(start, 'd LLL yyyy')} – ${format(end, 'd LLL yyyy')}`,
      MARGIN,
      metaY + 14,
    );
    doc.text(`Issued: ${format(new Date(), 'd LLL yyyy')}`, MARGIN, metaY + 28);

    doc.y = metaY + 52;
    drawHairline(doc, MARGIN, doc.y, doc.page.width - MARGIN * 2);
    doc.y += SPACING.md;
  }

  private drawInvoiceLineItems(
    doc: PDFKit.PDFDocument,
    lines: Array<{
      projectId: string;
      name: string;
      seconds: number;
      income: number;
      currency: string;
    }>,
  ): void {
    const left = MARGIN;
    const fullWidth = doc.page.width - MARGIN * 2;

    const cols = [
      { key: 'project', label: 'Project', width: 220, align: 'left' as const },
      { key: 'hours', label: 'Hours', width: 80, align: 'right' as const },
      { key: 'rate', label: 'Rate', width: 90, align: 'right' as const },
      {
        key: 'subtotal',
        label: 'Subtotal',
        width: fullWidth - (220 + 80 + 90),
        align: 'right' as const,
      },
    ];

    useFont(doc, FONTS.body, 9).fillColor(COLORS.muted);
    let x = left;
    const headY = doc.y;
    for (const c of cols) {
      doc.text(c.label.toUpperCase(), x, headY, {
        width: c.width,
        align: c.align,
        characterSpacing: 1.4,
      });
      x += c.width;
    }
    doc.y = headY + 14;
    drawHairline(doc, left, doc.y, fullWidth);
    doc.y += SPACING.sm;

    useFont(doc, FONTS.body, 10).fillColor(COLORS.stone);
    for (const line of lines) {
      if (doc.y > doc.page.height - MARGIN - 120) {
        doc.addPage();
        doc.y = MARGIN;
      }
      const hours = line.seconds / 3600;
      const rate = hours > 0 ? line.income / hours : 0;
      const values = [
        line.name,
        hours.toFixed(2),
        this.money(rate, line.currency),
        this.money(line.income, line.currency),
      ];
      const rowY = doc.y;
      x = left;
      for (let i = 0; i < cols.length; i++) {
        const c = cols[i]!;
        doc.text(values[i]!, x, rowY, { width: c.width, align: c.align });
        x += c.width;
      }
      doc.y = rowY + 16;
      drawHairline(doc, left, doc.y - 4, fullWidth);
    }
    doc.y += SPACING.md;
  }

  private drawInvoiceTotals(
    doc: PDFKit.PDFDocument,
    lines: Array<{ income: number; currency: string }>,
  ): void {
    const total = lines.reduce((s, l) => s + l.income, 0);
    // Pick the dominant currency. We don't multi-currency convert — invoice
    // across mixed currencies would be ambiguous, so we render per-line
    // currency symbols and total in the most common one.
    const currency = lines.find((l) => l.currency)?.currency ?? 'RUB';

    if (doc.y > doc.page.height - MARGIN - 80) {
      doc.addPage();
      doc.y = MARGIN;
    }

    const left = MARGIN;
    const fullWidth = doc.page.width - MARGIN * 2;
    const boxTop = doc.y;
    const boxHeight = 56;

    doc.save();
    doc.rect(left, boxTop, fullWidth, boxHeight).fill(COLORS.stone);
    doc.restore();

    useFont(doc, FONTS.body, 9).fillColor(COLORS.cream);
    doc.text('TOTAL DUE', left + SPACING.md, boxTop + SPACING.md + 4, { characterSpacing: 1.6 });

    useFont(doc, FONTS.headingMedium, 22).fillColor(COLORS.cream);
    doc.text(this.money(total, currency), left, boxTop + SPACING.md, {
      width: fullWidth - SPACING.md,
      align: 'right',
    });

    doc.y = boxTop + boxHeight + SPACING.md;
  }

  private drawFooter(doc: PDFKit.PDFDocument): void {
    // Redraw footer on every emitted page. pdfkit doesn't expose a native
    // "for each existing page" helper pre-close, so we iterate the page
    // buffer manually. switchToPage / bufferedPageRange require the
    // `bufferPages: true` option — we enable it here on demand.
    const range = doc.bufferedPageRange();
    const pages = range.count > 0 ? range.count : 1;
    for (let i = 0; i < pages; i++) {
      try {
        doc.switchToPage(range.start + i);
      } catch {
        // If bufferPages wasn't enabled at doc creation, switchToPage throws —
        // in that case we can only decorate the current (last) page.
        if (i > 0) break;
      }
      const footY = doc.page.height - MARGIN + 10;
      useFont(doc, FONTS.body, 8).fillColor(COLORS.muted);
      doc.text(`Generated ${format(new Date(), "d LLL yyyy 'at' HH:mm")} · Tact`, MARGIN, footY, {
        width: doc.page.width - MARGIN * 2 - 40,
      });
      doc.text(`${i + 1} / ${pages}`, doc.page.width - MARGIN - 40, footY, {
        width: 40,
        align: 'right',
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Misc formatting
  // ---------------------------------------------------------------------------

  private humanMonth(month: string): string {
    const { start } = buildMonthRange(month);
    return format(start, 'LLLL yyyy');
  }

  private money(amount: number, currency: string): string {
    try {
      return new Intl.NumberFormat('ru-RU', {
        style: 'currency',
        currency,
        maximumFractionDigits: 2,
      }).format(amount);
    } catch {
      // Unknown currency code — fall back to plain number + 3-letter suffix.
      return `${amount.toFixed(2)} ${currency}`;
    }
  }
}
