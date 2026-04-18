import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Transporter, SendMailOptions } from 'nodemailer';

import { SendAuthLinkDto, SendEmployeeInviteDto, SendMonthlyReportReadyDto } from './dto';
import {
  renderAuthLink,
  renderEmployeeInvite,
  renderMonthlyReportReady,
  type RenderedEmail,
} from './templates';

interface SmtpConfig {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  from: string;
}

/**
 * Transactional email delivery.
 *
 * Intentionally forgiving: if SMTP isn't configured (env missing), every
 * send() is a no-op that logs at info level. If delivery fails at runtime,
 * we log at warn level and return — callers should never have to wrap these
 * calls in try/catch. Email is a best-effort side channel, not a source of
 * truth.
 */
@Injectable()
export class NotificationService {
  private transporter: Transporter | null = null;
  private transporterInitAttempted = false;
  private smtpConfig: SmtpConfig | null = null;

  private readonly logger = new Logger(NotificationService.name);

  constructor(private readonly config: ConfigService) {}

  async sendEmployeeInvite(dto: SendEmployeeInviteDto): Promise<void> {
    const rendered = renderEmployeeInvite({
      companyName: dto.companyName,
      inviteLink: dto.inviteLink,
      telegramBotUsername: dto.telegramBotUsername,
    });
    await this.send({ to: dto.to, rendered, kind: 'employee-invite' });
  }

  async sendMonthlyReportReady(dto: SendMonthlyReportReadyDto): Promise<void> {
    const rendered = renderMonthlyReportReady({
      companyName: dto.companyName,
      month: dto.month,
      spreadsheetUrl: dto.spreadsheetUrl,
    });
    await this.send({ to: dto.to, rendered, kind: 'monthly-report-ready' });
  }

  async sendAuthLink(dto: SendAuthLinkDto): Promise<void> {
    const rendered = renderAuthLink({ magicLink: dto.magicLink });
    await this.send({ to: dto.to, rendered, kind: 'auth-link' });
  }

  // ---------- internals ----------

  /**
   * Actually deliver the email. Lazily builds a nodemailer transporter on
   * first use so missing env vars don't break app startup — we only notice
   * at the first send attempt, at which point we log and return.
   */
  private async send(params: { to: string; rendered: RenderedEmail; kind: string }): Promise<void> {
    const { to, rendered, kind } = params;
    const transporter = await this.getTransporter();
    if (!transporter || !this.smtpConfig) {
      this.logger.log(
        { kind, to, subject: rendered.subject },
        'SMTP not configured; skipping email delivery',
      );
      return;
    }

    const message: SendMailOptions = {
      from: this.smtpConfig.from,
      to,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
    };

    try {
      const info = await transporter.sendMail(message);
      this.logger.log(
        { kind, to, subject: rendered.subject, messageId: info.messageId },
        'email sent',
      );
    } catch (err) {
      // Never propagate — email is a side channel, not a source of truth.
      this.logger.warn(
        {
          kind,
          to,
          subject: rendered.subject,
          err: err instanceof Error ? err.message : String(err),
        },
        'email send failed',
      );
    }
  }

  /**
   * Lazily build (and cache) a nodemailer transporter from env. Returns null
   * when SMTP_HOST / MAIL_FROM are missing — that's the "gracefully no-op"
   * path. `nodemailer` is required lazily so missing node_modules during
   * local dev of unrelated modules don't crash the process.
   */
  private async getTransporter(): Promise<Transporter | null> {
    if (this.transporterInitAttempted) return this.transporter;
    this.transporterInitAttempted = true;

    const host = this.config.get<string>('SMTP_HOST')?.trim();
    const portRaw = this.config.get<string | number>('SMTP_PORT');
    const user = this.config.get<string>('SMTP_USER')?.trim();
    const pass = this.config.get<string>('SMTP_PASS');
    const from = this.config.get<string>('MAIL_FROM')?.trim();

    if (!host || !from) {
      this.logger.log(
        { hasHost: Boolean(host), hasFrom: Boolean(from) },
        'SMTP_HOST or MAIL_FROM not set; notifications will be logged only',
      );
      return null;
    }

    const port = portRaw
      ? typeof portRaw === 'number'
        ? portRaw
        : Number.parseInt(String(portRaw), 10)
      : 587;
    if (!Number.isFinite(port) || port <= 0) {
      this.logger.warn({ portRaw }, 'SMTP_PORT invalid; skipping SMTP init');
      return null;
    }

    this.smtpConfig = { host, port, user, pass, from };

    try {
      // Lazy-require so a missing nodemailer (e.g. until `pnpm install` lands)
      // doesn't crash boot — we fall through to the no-op path instead.
      const mod = (await import('nodemailer')) as typeof import('nodemailer');
      const auth = user && pass ? { user, pass } : undefined;
      this.transporter = mod.createTransport({
        host,
        port,
        // Assume TLS on 465, STARTTLS on everything else. Keeps config light
        // while still matching the common provider presets.
        secure: port === 465,
        auth,
      });
      this.logger.log({ host, port, authenticated: Boolean(auth) }, 'SMTP transporter initialized');
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'failed to initialize SMTP transporter; notifications will be logged only',
      );
      this.transporter = null;
    }

    return this.transporter;
  }
}
