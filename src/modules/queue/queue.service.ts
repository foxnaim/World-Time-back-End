import { Inject, Injectable, Logger, Optional, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { NotificationService } from '@/modules/notification/notification.service';
import { SheetsService } from '@/modules/sheets/sheets.service';
import { ReportService } from '@/modules/report/report.service';

import {
  type EmailJobName,
  type EmployeeInviteJob,
  type MonthlyReportJob,
  type AuthLinkJob,
  type SheetsExportJob,
  type PdfReportJob,
  type EnqueueOptions,
} from './queues';

/**
 * QueueService — sync-fallback-only stub.
 *
 * The full BullMQ-backed implementation is temporarily disabled (see
 * {@link ./queue.module.ts}). Every `enqueue*` method runs the work inline
 * against the corresponding service, keeping call-site semantics identical
 * while the queue infra is reintroduced.
 *
 * TODO: restore BullMQ (`@nestjs/bullmq`, `bullmq`, per-queue processors in
 * ./processors/*.processor.ts) and wire REDIS_URL via ConfigService once
 * those deps are reinstated.
 */
@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    private readonly config: ConfigService,
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
    void this.config;
    this.logger.log('QueueService running in sync-fallback-only mode (BullMQ stubbed)');
  }

  /** Always false in the stub; callers that branch on this still work. */
  get isEnabled(): boolean {
    return false;
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
    _opts?: EnqueueOptions,
  ): Promise<{ jobId: string }> {
    await this.runEmailSync(name, data);
    return { jobId: 'sync' };
  }

  // ---------- sheets export ----------

  async enqueueSheetsExport(
    data: SheetsExportJob,
    _opts?: EnqueueOptions,
  ): Promise<{ jobId: string }> {
    await this.runSheetsExportSync(data);
    return { jobId: 'sync' };
  }

  // ---------- pdf report ----------

  async enqueuePdfReport(data: PdfReportJob, _opts?: EnqueueOptions): Promise<{ jobId: string }> {
    await this.runPdfSync(data);
    return { jobId: 'sync' };
  }

  // ---------- helpers ----------

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
        await this.notifications.sendMonthlyReportReady(data as MonthlyReportJob);
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
    if (data.kind === 'attendance') {
      await this.reports.buildAttendancePdf(data.companyId, data.month);
    } else {
      await this.reports.buildInvoicePdf(data.userId, data.month, data.projectId);
    }
  }
}
