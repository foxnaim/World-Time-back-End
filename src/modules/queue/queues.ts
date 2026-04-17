/**
 * Canonical queue names + shared job-payload shapes.
 *
 * Import via `QUEUES.EMAIL` etc. rather than raw strings so a typo at a call
 * site is a compile error. The `as const` assertion plus the `QueueName`
 * type mean any new queue added here is automatically known to every
 * consumer.
 */
export const QUEUES = {
  EMAIL: 'email',
  SHEETS_EXPORT: 'sheets-export',
  PDF_REPORT: 'pdf-report',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

// ---------- email ----------

export type EmailJobName = 'employee-invite' | 'monthly-report' | 'auth-link';

export interface EmployeeInviteJob {
  to: string;
  companyName: string;
  inviteLink: string;
  telegramBotUsername?: string;
}

export interface MonthlyReportJob {
  to: string;
  companyName: string;
  month: string;
  spreadsheetUrl: string;
}

export interface AuthLinkJob {
  to: string;
  magicLink: string;
}

export type EmailJobPayload =
  | { name: 'employee-invite'; data: EmployeeInviteJob }
  | { name: 'monthly-report'; data: MonthlyReportJob }
  | { name: 'auth-link'; data: AuthLinkJob };

// ---------- sheets export ----------

export interface SheetsExportJob {
  companyId: string;
  month: string; // "YYYY-MM"
  requestedBy?: string;
}

// ---------- pdf report ----------

export type PdfReportKind = 'attendance' | 'invoice';

export interface AttendancePdfJob {
  kind: 'attendance';
  companyId: string;
  month: string;
}

export interface InvoicePdfJob {
  kind: 'invoice';
  userId: string;
  month: string;
  projectId?: string;
}

export type PdfReportJob = AttendancePdfJob | InvoicePdfJob;

// ---------- enqueue options ----------

export interface EnqueueOptions {
  /** Delay (ms) before the job becomes available to a worker. */
  delay?: number;
  /** Total attempts including the first. Defaults to 3. */
  attempts?: number;
  /** Exponential backoff base delay in ms. Defaults to 5_000. */
  backoffMs?: number;
  /** Optional idempotency key — BullMQ will dedupe by jobId. */
  jobId?: string;
}
