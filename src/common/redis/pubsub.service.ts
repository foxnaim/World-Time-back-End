import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import type { QRTokenDisplay } from '@tact/types';

import { RedisService } from './redis.service';

/**
 * PubSubService
 *
 * Typed, domain-aware wrapper on top of RedisService's raw channel pub/sub.
 * The only current use case is broadcasting QR token rotations across
 * backend replicas so that every office display stays in sync regardless
 * of which node happens to be serving its SSE stream.
 *
 * -----------------------------------------------------------------------
 * Why this layer exists
 * -----------------------------------------------------------------------
 *
 *   1. The previous SSE hub held one RxJS ReplaySubject per companyId,
 *      entirely in-process. That is correct for a single-replica deploy
 *      but silently breaks under horizontal scale: a rotation minted on
 *      replica A never reaches a display connected to replica B.
 *
 *   2. Raw ioredis pub/sub is unstructured (string channels, string
 *      payloads) and does not deduplicate subscribers. We want:
 *         - Channel naming discipline:  qr:company:<id>
 *         - JSON (de)serialization in one place
 *         - Exactly one Redis SUBSCRIBE per companyId even when N SSE
 *           clients attach to the same replica (refCount multicast)
 *
 *   3. Keeping the last emitted value somewhere is STILL required on top
 *      of pub/sub. Redis pub/sub is fire-and-forget — a subscriber that
 *      connects 10ms after a rotation sees nothing until the NEXT rotation
 *      (up to 30s of blank screen). The combination used by the system is:
 *         - RedisService.publish  → fan out to other replicas
 *         - A per-companyId last-value cache on the SseHub (ReplaySubject
 *           with buffer=1) → replay on new local subscriber
 *      This service is the "cross-replica delivery" half; the SseHub owns
 *      the "replay latest to new connectee" half.
 */
@Injectable()
export class PubSubService implements OnModuleDestroy {
  private readonly logger = new Logger(PubSubService.name);

  /**
   * One hot Subject per companyId, plus its unsubscribe handle returned by
   * RedisService.subscribe. The Subject is created on first call to
   * subscribeCompany$, SUBSCRIBED to Redis exactly once, and torn down
   * when the refCount drops back to zero (no more SSE clients for that
   * company on this replica).
   */
  private readonly streams = new Map<
    string,
    {
      subject: Subject<QRTokenDisplay>;
      /** Count of active RxJS subscribers sharing this Redis subscription. */
      refCount: number;
      /** Pending or completed unsubscribe handle from RedisService. */
      unsubPromise: Promise<() => Promise<void>>;
    }
  >();

  constructor(private readonly redis: RedisService) {}

  async onModuleDestroy(): Promise<void> {
    // Tear down every live Redis subscription cleanly. The RedisService
    // itself will also close its subscriber connection, so this is
    // belt-and-braces to avoid stranded channels mid-shutdown.
    const entries = Array.from(this.streams.values());
    this.streams.clear();
    await Promise.all(
      entries.map(async (entry) => {
        try {
          const unsub = await entry.unsubPromise;
          await unsub();
        } catch {
          /* best effort during shutdown */
        }
        entry.subject.complete();
      }),
    );
  }

  /** Channel name for a given company. Kept private so it can be changed centrally. */
  private channelFor(companyId: string): string {
    return `qr:company:${companyId}`;
  }

  /**
   * Serialize and broadcast a QR token rotation for a company. When Redis
   * is degraded this is a cheap no-op — callers are expected to ALSO push
   * the same payload into the in-process SseHub, which is what actually
   * serves local SSE clients. Returns the number of other replicas that
   * received the message (0 in single-node or degraded mode).
   */
  async publishToCompany(companyId: string, payload: QRTokenDisplay): Promise<number> {
    if (!this.redis.isRedisReady) return 0;
    try {
      const json = JSON.stringify(payload);
      return await this.redis.publish(this.channelFor(companyId), json);
    } catch (err) {
      this.logger.warn(
        `publishToCompany(${companyId}) failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return 0;
    }
  }

  /**
   * Lower-level subscription API — register a handler that fires for every
   * rotation on this company, cluster-wide. Returns an async unsubscribe.
   *
   * Prefer subscribeCompany$ if you are an RxJS consumer; this form is
   * kept for tests and for non-Rx call sites.
   */
  async subscribeCompany(
    companyId: string,
    handler: (payload: QRTokenDisplay) => void,
  ): Promise<() => Promise<void>> {
    return this.redis.subscribe(this.channelFor(companyId), (msg) => {
      try {
        const parsed = JSON.parse(msg) as QRTokenDisplay;
        handler(parsed);
      } catch (err) {
        this.logger.warn(
          `Malformed pub/sub payload on company=${companyId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    });
  }

  /**
   * Observable of QR rotations for a company, multicast with refCount.
   *
   * - First subscriber triggers a Redis SUBSCRIBE for the channel.
   * - Subsequent subscribers share the same underlying subscription.
   * - When the last subscriber unsubscribes, we UNSUBSCRIBE from Redis
   *   and drop the Subject — the next subscribe will cold-start again.
   *
   * Note: this Observable does NOT replay the most recent value to new
   * subscribers. That is a deliberate split of responsibilities: pub/sub
   * is strictly "events from now on", and the SseHub layers a
   * ReplaySubject(1) cache on top for replay semantics.
   */
  subscribeCompany$(companyId: string): Observable<QRTokenDisplay> {
    return new Observable<QRTokenDisplay>((observer) => {
      let entry = this.streams.get(companyId);

      if (!entry) {
        // Cold start: create the per-company Subject and kick off the
        // Redis SUBSCRIBE. We store the PROMISE (not the resolved unsub)
        // so that very-fast-cycle subscribe/unsubscribe races can't end
        // up with two concurrent subscribes racing on the same channel.
        const subject = new Subject<QRTokenDisplay>();
        const unsubPromise = this.subscribeCompany(companyId, (payload) => {
          subject.next(payload);
        }).catch((err) => {
          this.logger.warn(
            `Redis subscribe(${companyId}) failed, continuing with empty stream: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          // Return a noop unsub so teardown paths don't explode.
          return async () => {};
        });
        entry = { subject, refCount: 0, unsubPromise };
        this.streams.set(companyId, entry);
      }

      entry.refCount += 1;
      const sub = entry.subject.subscribe(observer);

      return () => {
        sub.unsubscribe();
        const current = this.streams.get(companyId);
        if (!current) return;
        current.refCount -= 1;
        if (current.refCount <= 0) {
          // Last RxJS subscriber gone — release the Redis subscription.
          this.streams.delete(companyId);
          current.unsubPromise
            .then((unsub) => unsub())
            .catch(() => {
              /* best effort */
            });
          current.subject.complete();
        }
      };
    });
  }
}
