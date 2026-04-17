import {
  Inject,
  Injectable,
  Logger,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue, JobsOptions } from 'bullmq';

import { NotificationService } from '@/modules/notification/notification.service';
import { SheetsService } from '@/modules/sheets/sheets.service';
import { ReportService } from '@/modules/report/report.service';

import {
  QUEUES,
  type EmailJobName,
  type EmployeeInviteJob,
  type MonthlyReportJob,
  type AuthLinkJob,
  type SheetsExportJob,
  type PdfReportJob,
  type EnqueueOptions,
} from './queues';

/**
 * Typed enqueue wrapper around BullMQ.
 *
 * Two responsibilities:
 *   1. Hide BullMQ's untyped `Queue.add(name, data, opts)` behind a method
 *      per job type so the compiler catches payload mismatches.
 *   2. Provide a sync fallback when the queue isn't usable — either because
 *      QUEUE_ENABLED is false, REDIS_URL is unset, or BullMQ cannot reach
 *      the broker. The caller gets identical behavior either way; only the
 *      `jobId` field of the return value changes (`"sync"` in fallback
 *      mode). This keeps the rest of the app blissfully ignorant of queue
 *      availability.
 */
@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);
  private readonly enabled: boolean;

  constructor(
    private readonly config: ConfigService,
    @InjectQueue(QUEUES.EMAIL) private readonly emailQueue: Queue,
    @InjectQueue(QUEUES.SHEETS_EXPORT) private readonly sheetsQueue: Queue,
    @InjectQueue(QUEUES.PDF_REPORT) private readonly pdfQueue: Queue,
    // Sync fallback services. Optional + forwardRef to avoid DI cycles when
    // callers (e.g. NotificationService) inject QueueService themselves.
    @Optional()
    @Inject(forwardRef(() => NotificationService))
    private readonly notifications?: NotificationService,
    @Optional()
    @Inject(forwardRef(() => SheetsService))
    private readonly sheets?: SheetsService,
    @Optional()
    @Inject(forwardRef(() => ReportService))
    private readonly reports?: ReportService,
  ) {
    const flag = this.config.get<string>('QUEUE_ENABLED');
    const redisUrl = this.config.get<string>('REDIS_URL')?.trim();
    // Default: enabled iff REDIS_URL is set. QUEUE_ENABLED=false force-
    // disables even when a URL is configured (useful for CI / tests).
    this.enabled =
      Boolean(redisUrl) && flag !== 'false' && flag !== '0';
    if (!this.enabled) {
      this.logger.log(
        'QueueService running in sync fallback mode (REDIS_URL unset or QUEUE_ENABLED=false)',
      );
    }
  }

  /** Exposed for health checks and tests. */
  get isEnabled(): boolean {
    return this.enabled;
  }

  // ---------- email ----------

  async enqueueEmail(
    name: 'employee-invite',
    data: EmployeeInviteJob,
    opts?: EnqueueOptions,
  ): Promise<{ jobId: string }>;
  async enqueueEmail(
    name: 'monthly-report',
    data: MonthlyReportJob,
    opts?: EnqueueOptions,
  ): Promise<{ jobId: string }>;
  async enqueueEmail(
    name: 'auth-link',
    data: AuthLinkJob,
    opts?: EnqueueOptions,
  ): Promise<{ jobId: string }>;
  async enqueueEmail(
    name: EmailJobName,
    data: EmployeeInviteJob | MonthlyReportJob | AuthLinkJob,
    opts?: EnqueueOptions,
  ): Promise<{ jobId: string }> {
    if (!this.enabled) {
      await this.runEmailSync(name, data);
      return { jobId: 'sync' };
    }
    try {
      const job = await this.emailQueue.add(name, data, this.bullOpts(opts));
      return { jobId: String(job.id ?? 'unknown') };
    } catch (err) {
      this.logger.warn(
        `enqueueEmail(${name}) failed: ${(err as Error).message} — running inline`,
      );
      await this.runEmailSync(name, data);
      return { jobId: 'sync' };
    }
  }

  // ---------- sheets export ----------

  async enqueueSheetsExport(
    data: SheetsExportJob,
    opts?: EnqueueOptions,
  ): Promise<{ jobId: string }> {
    if (!this.enabled) {
      await this.runSheetsExportSync(data);
      return { jobId: 'sync' };
    }
    try {
      const job = await this.sheetsQueue.add(
        'export-company-month',
        data,
        this.bullOpts(opts),
      );
      return { jobId: String(job.id ?? 'unknown') };
    } catch (err) {
      this.logger.warn(
        `enqueueSheetsExport failed: ${(err as Error).message} — running inline`,
      );
      await this.runSheetsExportSync(data);
      return { jobId: 'sync' };
    }
  }

  // ---------- pdf report ----------

  async enqueuePdfReport(
    data: PdfReportJob,
    opts?: EnqueueOptions,
  ): Promise<{ jobId: string }> {
    if (!this.enabled) {
      await this.runPdfSync(data);
      return { jobId: 'sync' };
    }
    try {
      const job = await this.pdfQueue.add(data.kind, data, this.bullOpts(opts));
      return { jobId: String(job.id ?? 'unknown') };
    } catch (err) {
      this.logger.warn(
        `enqueuePdfReport failed: ${(err as Error).message} — running inline`,
      );
      await this.runPdfSync(data);
      return { jobId: 'sync' };
    }
  }

  // ---------- helpers ----------

  private bullOpts(opts?: EnqueueOptions): JobsOptions {
    const attempts = opts?.attempts ?? 3;
    const backoffMs = opts?.backoffMs ?? 5_000;
    return {
      delay: opts?.delay,
      attempts,
      backoff: { type: 'exponential', delay: backoffMs },
      jobId: opts?.jobId,
      removeOnComplete: { age: 3_600, count: 1_000 },
      removeOnFail: { age: 24 * 3_600 },
    };
  }

  private async runEmailSync(
    name: EmailJobName,
    data: EmployeeInviteJob | MonthlyReportJob | AuthLinkJob,
  ): Promise<void> {
    if (!this.notifications) {
      this.logger.warn(
        `sync email fallback requested but NotificationService not available (name=${name})`,
      );
      return;
    }
    switch (name) {
      case 'employee-invite':
        await this.notifications.sendEmployeeInvite(data as EmployeeInviteJob);
        return;
      case 'monthly-report':
        await this.notifications.sendMonthlyReportReady(
          data as MonthlyReportJob,
        );
        return;
      case 'auth-link':
        await this.notifications.sendAuthLink(data as AuthLinkJob);
        return;
    }
  }

  private async runSheetsExportSync(data: SheetsExportJob): Promise<void> {
    if (!this.sheets) {
      this.logger.warn('sync sheets-export fallback requested but SheetsService not available');
      return;
    }
    await this.sheets.exportCompanyMonth(data.companyId, data.month);
  }

  private async runPdfSync(data: PdfReportJob): Promise<void> {
    if (!this.reports) {
      this.logger.warn('sync pdf fallback requested but ReportService not available');
      return;
    }
    // Sync fallback just builds the stream — caller already handled streaming
    // in the HTTP layer. The processor path persists the artifact somewhere;
    // since neither is wired to storage yet, we no-op beyond building to
    // validate the pipeline.
    if (data.kind === 'attendance') {
      await this.reports.buildAttendancePdf(data.companyId, data.month);
    } else {
      await this.reports.buildInvoicePdf(data.userId, data.month, data.projectId);
    }
  }
}
