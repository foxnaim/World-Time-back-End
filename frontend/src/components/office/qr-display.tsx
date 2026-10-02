'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import type { DialProps } from '@tact/ui';
import { Clock } from './clock';
import { QrCode } from './qr-code';
import { useSse, type SseConnectionState } from './use-sse';

// Dynamic import with ssr:false prevents hydration mismatches caused by
// floating-point differences in Math.cos/sin between Node.js and the browser.
const Dial = dynamic<DialProps>(
  () => import('@tact/ui').then((m) => ({ default: m.Dial })),
  { ssr: false },
);

interface QrPayload {
  token: string;
  expiresAt: string; // ISO timestamp
  rotationInSec: number;
}

export interface QrDisplayProps {
  companyId: string;
  /** Optional display name to show top-left. Falls back to companyId. */
  companyName?: string;
}

const BOT_USERNAME = 'worktact_bot';

function buildTelegramUrl(token: string): string {
  return `https://t.me/${BOT_USERNAME}?start=qr_${encodeURIComponent(token)}`;
}

function connectionCopy(state: SseConnectionState): string | null {
  if (state === 'error') {
    return 'Соединение с сервером потеряно. Попытка переподключения...';
  }
  return null;
}

/**
 * Full-screen QR display for a permanently-mounted office tablet.
 *
 * - Opens an SSE stream; on error transparently falls back to 15s polling.
 * - Shows a rotating countdown dial (drains counterclockwise) until the
 *   next token rotation (every 30s, 45s TTL).
 * - Renders a deterministic *placeholder* QR (see `pseudo-qr.tsx`).
 */
export function QrDisplay({ companyId, companyName }: QrDisplayProps) {
  const displayKey =
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('key') : null;

  const sseUrl = useMemo(() => {
    const base = `/api/checkin/qr/${encodeURIComponent(companyId)}/stream`;
    return displayKey ? `${base}?key=${encodeURIComponent(displayKey)}` : base;
  }, [companyId, displayKey]);

  const pollUrl = useMemo(() => {
    const base = `/api/checkin/qr/${encodeURIComponent(companyId)}/current`;
    return displayKey ? `${base}?key=${encodeURIComponent(displayKey)}` : base;
  }, [companyId, displayKey]);

  const { data, state } = useSse<QrPayload>({
    url: sseUrl,
    pollUrl,
    pollIntervalMs: 15_000,
    // Note: EventSource cannot carry custom headers; the server supports
    // `?key=` as a fallback, and polling reuses the same query form. The
    // header path (X-Display-Key via NEXT_PUBLIC_DISPLAY_KEY) only exists
    // for same-origin fetches that need it — wire here if policy tightens.
  });

  // Live countdown tick: 10Hz is smooth enough for the dial without burning CPU.
  const [tickNow, setTickNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setTickNow(Date.now()), 100);
    return () => clearInterval(id);
  }, []);

  const [dialSize, setDialSize] = useState(580);
  useEffect(() => {
    function onResize() {
      const w = window.innerWidth;
      setDialSize(w < 640 ? 400 : w < 1024 ? 520 : 620);
    }
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const [presence, setPresence] = useState<{
    present: number;
    total: number;
    arrivedToday: number;
    companyName: string | null;
  } | null>(null);

  useEffect(() => {
    async function fetchPresence() {
      try {
        const base = `/api/checkin/qr/${encodeURIComponent(companyId)}/presence`;
        const url = displayKey ? `${base}?key=${encodeURIComponent(displayKey)}` : base;
        const res = await fetch(url);
        if (res.ok) {
          const raw = (await res.json()) as {
            present: number;
            total: number;
            arrivedToday?: number;
            companyName?: string | null;
          };
          // Backward-compat: older backends may not send arrivedToday/companyName.
          setPresence({
            ...raw,
            arrivedToday: raw.arrivedToday ?? 0,
            companyName: raw.companyName ?? null,
          });
        }
      } catch { /* ignore network errors */ }
    }
    void fetchPresence();
    const id = setInterval(fetchPresence, 30_000);
    return () => clearInterval(id);
  }, [companyId, displayKey]);

  const expiresMs = data?.expiresAt ? Date.parse(data.expiresAt) : null;
  const rotationSec = data?.rotationInSec ?? 30;
  const rotationMs = rotationSec * 1000;

  const remainingMs =
    expiresMs !== null ? Math.max(0, Math.min(rotationMs, expiresMs - tickNow)) : rotationMs;

  const remainingSec = Math.ceil(remainingMs / 1000);

  const qrValue = data?.token ? buildTelegramUrl(data.token) : '';
  const banner = connectionCopy(state);

  // "All clear" = the office opened, everyone who came in has left.
  // Without requiring `arrivedToday > 0`, we'd hide the QR at the start of the
  // day (0 present, 1+ total) and nobody could check in.
  const allClear =
    presence !== null &&
    presence.present === 0 &&
    presence.total > 0 &&
    presence.arrivedToday > 0;

  const hourProgress = useMemo(() => {
    const d = new Date(tickNow);
    return (d.getHours() % 12 + d.getMinutes() / 60) / 12;
  }, [tickNow]);

  const stateLabel =
    state === 'sse'
      ? 'Live'
      : state === 'polling'
        ? 'Poll'
        : state === 'error'
          ? 'Offline'
          : 'Init';

  const qrAriaLabel = data?.token
    ? `QR-код для отметки прихода и ухода. Обновится через ${remainingSec} секунд.`
    : 'Ожидание QR-кода для отметки прихода и ухода.';

  return (
    <main
      className="fixed inset-0 overflow-hidden bg-cream text-[#2a2927]"
      style={{ fontFamily: 'var(--font-inter), system-ui, sans-serif' }}
    >
      {/* Top bar: company (left) / clock (right) */}
      <header className="absolute inset-x-0 top-0 z-10 flex items-start justify-between px-10 pt-10">
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-[0.32em] text-[#6b6966]">Компания</span>
          <span
            className="mt-1 text-sm font-medium text-[#2a2927]"
            style={{ letterSpacing: '0.02em' }}
          >
            {companyName ?? presence?.companyName ?? '—'}
          </span>
        </div>
        <Clock />
      </header>

      {/* Main stage: large clock dial with QR / reveal overlay in center */}
      <section className="absolute inset-0 flex items-center justify-center">
        <div className="relative flex items-center justify-center">
          <Dial
            size={dialSize}
            progress={hourProgress}
            ticks={60}
            highlightStart={9 / 24}
            highlightEnd={18 / 24}
            indicatorColor="coral"
          />

          {/* QR code — visible when employees are present or unknown */}
          <div
            className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-5"
            style={{
              opacity: allClear ? 0 : 1,
              transition: 'opacity 1.2s ease-in-out',
            }}
          >
            <div role="img" aria-label={qrAriaLabel}>
              <QrCode
                value={qrValue || `worktime:${companyId}:bootstrap`}
                size={Math.round(dialSize * 0.36)}
              />
            </div>
            <div className="flex items-baseline gap-2 tabular-nums">
              <span
                className="text-2xl text-[#2a2927]"
                style={{
                  fontFamily: 'var(--font-fraunces), Georgia, serif',
                  fontWeight: 500,
                  letterSpacing: '-0.02em',
                }}
              >
                {String(remainingSec).padStart(2, '0')}
              </span>
              <span className="text-[10px] uppercase tracking-[0.3em] text-[#6b6966]">
                сек до обновления
              </span>
            </div>
          </div>

          {/* WORK TACT — revealed when all employees have left */}
          <div
            className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center"
            style={{
              opacity: allClear ? 1 : 0,
              transition: 'opacity 1.6s ease-in-out',
              fontFamily: 'var(--font-fraunces), Georgia, serif',
            }}
          >
            <span className="text-[10px] uppercase tracking-[0.4em] text-[#3d3b38]">
              Time, in rhythm
            </span>
            <span
              className="mt-2 text-5xl sm:text-6xl md:text-7xl font-medium leading-[0.9] tracking-tight text-[#3d3b38]"
              style={{ fontVariationSettings: "'opsz' 144" }}
            >
              WORK
              <br />
              TACT
            </span>
            <span className="mt-3 text-[10px] uppercase tracking-[0.4em] text-[#E98074]">
              {new Date(tickNow).getFullYear()}
            </span>
          </div>
        </div>
      </section>

      {/* Presence indicator */}
      {presence && presence.total > 0 && (
        <div className="absolute bottom-24 inset-x-0 flex justify-center">
          <span className="text-[10px] uppercase tracking-[0.3em] text-[#6b6966]">
            {presence.present} / {presence.total} в офисе
          </span>
        </div>
      )}

      {/* Connection error banner */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className={
          banner
            ? 'absolute inset-x-0 top-24 mx-auto w-fit max-w-[80%] border border-[#E85A4F]/50 bg-[#E85A4F]/5 px-4 py-2'
            : 'sr-only'
        }
      >
        {banner ? (
          <span className="text-[11px] uppercase tracking-[0.24em] text-[#E85A4F]">{banner}</span>
        ) : (
          <span>{`Состояние соединения: ${stateLabel}`}</span>
        )}
      </div>

      {/* Bottom: tick ruler + wordmark + connection state */}
      <footer className="absolute inset-x-0 bottom-0 z-10 px-10 pb-8">
        <div className="flex items-end justify-between">
          <TickRuler />
          <div className="flex items-baseline gap-3">
            <span
              className="text-[10px] uppercase tracking-[0.32em] text-[#6b6966]"
              aria-hidden="true"
            >
              {stateLabel}
            </span>
            <span
              className="text-xs uppercase tracking-[0.45em] text-[#2a2927]"
              style={{ fontWeight: 500 }}
            >
              Work Tact
            </span>
          </div>
        </div>
      </footer>
    </main>
  );
}

/** Slim 40-tick ruler for the bottom-left, matches editorial chrome. */
function TickRuler() {
  const ticks = Array.from({ length: 48 });
  return (
    <div className="flex items-end gap-[4px]" aria-hidden="true" style={{ height: 14 }}>
      {ticks.map((_, i) => {
        const isMajor = i % 6 === 0;
        return (
          <span
            key={i}
            className="block bg-stone"
            style={{
              width: 1,
              height: isMajor ? 14 : 7,
              opacity: isMajor ? 0.55 : 0.25,
            }}
          />
        );
      })}
    </div>
  );
}
