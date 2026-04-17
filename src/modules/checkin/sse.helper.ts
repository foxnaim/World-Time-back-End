import { Injectable, Logger } from '@nestjs/common';
import { Observable, ReplaySubject } from 'rxjs';
import type { QRTokenDisplay } from '@worktime/types';

/**
 * SseHub
 *
 * Holds one RxJS ReplaySubject per companyId so that:
 *   1. The QrService can push freshly-rotated tokens without knowing anything
 *      about the HTTP layer.
 *   2. Multiple office displays (and admin dashboards) can subscribe to the
 *      same company's rotation stream and instantly receive the most recent
 *      token (ReplaySubject buffer = 1) upon connect, avoiding a "blank"
 *      screen until the next rotation.
 *
 * Subjects are keyed by companyId and created lazily. We intentionally do not
 * tear them down on unsubscribe — the set of companies is small and bounded,
 * and keeping the subject around means reconnects are cheap.
 */
@Injectable()
export class SseHub {
  private readonly logger = new Logger(SseHub.name);
  private readonly subjects = new Map<string, ReplaySubject<QRTokenDisplay>>();

  private getOrCreate(companyId: string): ReplaySubject<QRTokenDisplay> {
    let subject = this.subjects.get(companyId);
    if (!subject) {
      subject = new ReplaySubject<QRTokenDisplay>(1);
      this.subjects.set(companyId, subject);
      this.logger.debug(`SSE subject created for company=${companyId}`);
    }
    return subject;
  }

  /** Emit a new token payload to every subscriber for the given company. */
  publish(companyId: string, payload: QRTokenDisplay): void {
    this.getOrCreate(companyId).next(payload);
  }

  /** Observable stream of token rotations for the given company. */
  stream(companyId: string): Observable<QRTokenDisplay> {
    return this.getOrCreate(companyId).asObservable();
  }
}
