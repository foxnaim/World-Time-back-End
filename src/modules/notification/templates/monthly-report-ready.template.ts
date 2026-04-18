import { escapeHtml, layout, type RenderedEmail } from './shared';

interface MonthlyReportReadyInput {
  companyName: string;
  /** ISO year-month, e.g. "2026-04". */
  month: string;
  spreadsheetUrl: string;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function formatMonth(month: string): string {
  const match = /^(\d{4})-(\d{2})$/u.exec(month);
  if (!match) return month;
  const year = match[1];
  const monthIndex = Number(match[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) return month;
  return `${MONTH_NAMES[monthIndex]} ${year}`;
}

/**
 * Emails the company owner that a monthly sheet export finished. Keeps the
 * email content light — the real detail lives in the Google Sheet.
 */
export function renderMonthlyReportReady(input: MonthlyReportReadyInput): RenderedEmail {
  const { companyName, month, spreadsheetUrl } = input;
  const safeCompany = escapeHtml(companyName);
  const safeUrl = escapeHtml(spreadsheetUrl);
  const friendlyMonth = formatMonth(month);
  const safeMonth = escapeHtml(friendlyMonth);

  const subject = `Work Tact — ${friendlyMonth} report is ready for ${companyName}`;
  const preheader = `Your ${friendlyMonth} attendance and payroll summary is live on Google Sheets.`;

  const bodyHtml = `
    <h1>${safeMonth} report is ready</h1>
    <p>We finished compiling the <strong>${safeMonth}</strong> attendance and payroll summary for <strong>${safeCompany}</strong>. Two tabs are waiting for you: <em>Attendance</em> for the raw check-ins and <em>Summary</em> for hours, lateness, and payout totals per employee.</p>
    <p><a class="button" href="${safeUrl}">Open the spreadsheet</a></p>
    <hr class="divider" />
    <p class="muted">If the button doesn't work, copy and paste this link into your browser:</p>
    <p class="fallback-link">${safeUrl}</p>
  `;

  const html = layout({ title: subject, preheader, bodyHtml });

  const text = [
    `${friendlyMonth} report is ready for ${companyName}`,
    '',
    `We finished compiling the ${friendlyMonth} attendance and payroll summary for ${companyName}.`,
    'Two tabs are waiting for you: Attendance for raw check-ins and Summary for hours, lateness, and payout totals per employee.',
    '',
    `Open the spreadsheet: ${spreadsheetUrl}`,
  ].join('\n');

  return { subject, html, text };
}
