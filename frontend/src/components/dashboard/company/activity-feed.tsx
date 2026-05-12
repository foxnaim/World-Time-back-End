'use client';

import * as React from 'react';
import useSWR from 'swr';
import { Card, cn } from '@tact/ui';
import { fetcher } from '@/lib/fetcher';
import { useLang } from '@/i18n/context';

/** Mirrors the backend `ActivityItem` shape from GET /api/companies/:id/activity. */
type ActivityItem = {
  id: string;
  employeeName: string;
  type: 'IN' | 'OUT';
  timestamp: string;
  late: boolean;
};

/** HH:MM in the viewer's locale/timezone. */
function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

/**
 * Best-effort lateness hint for the badge. The API only tells us *that* a
 * check-in was late (relative to the company-local workday start + 30 min),
 * not by how much, so we approximate against a 09:00 + 30 min baseline in the
 * viewer's timezone. When the result isn't positive we fall back to a generic
 * badge with no number.
 */
function lateMinutesHint(iso: string): number | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const minutes = d.getHours() * 60 + d.getMinutes() - (9 * 60 + 30);
  return minutes > 0 ? minutes : null;
}

function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-[#D8C3A5]/40', className)} />;
}

export function ActivityFeed({ companyId }: { companyId: string | undefined }) {
  const { t } = useLang();

  const { data, error } = useSWR<ActivityItem[]>(
    companyId ? `/api/companies/${companyId}/activity?limit=20` : null,
    fetcher,
    { refreshInterval: 30000 },
  );

  return (
    <Card eyebrow={t('overview.activityEyebrow')} title={t('overview.activityTitle')}>
      {error ? (
        <div className="py-6 text-center text-sm text-[#E85A4F] tracking-tight">
          {t('overview.genericLoadError')}
        </div>
      ) : !data ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : data.length === 0 ? (
        <div className="py-10 text-center">
          <div className="text-3xl text-[#6b6966]" style={{ fontFamily: 'Fraunces, serif' }}>
            {t('overview.activityEmptyTitle')}
          </div>
          <div className="mt-1 text-[11px] uppercase tracking-[0.22em] text-[#6b6966]">
            {t('overview.activityEmptyHint')}
          </div>
        </div>
      ) : (
        <ul className="flex flex-col">
          {data.map((item, i) => {
            const time = fmtTime(item.timestamp);
            const lateMin = item.late ? lateMinutesHint(item.timestamp) : null;
            const label =
              item.type === 'IN'
                ? t('overview.activityArrived', { name: item.employeeName, time })
                : t('overview.activityLeft', { name: item.employeeName, time });
            return (
              <li
                key={item.id}
                className={cn(
                  'flex items-center justify-between gap-4 py-3',
                  i !== data.length - 1 && 'border-b border-[#8E8D8A]/15',
                )}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <span
                    aria-hidden
                    className={cn(
                      'h-2 w-2 shrink-0 rounded-full',
                      item.type === 'IN' ? 'bg-[#4CAF50]' : 'bg-[#8E8D8A]',
                    )}
                  />
                  <span
                    className="truncate text-base text-[#3d3b38]"
                    style={{ fontFamily: 'Fraunces, serif' }}
                  >
                    {label}
                  </span>
                </span>
                {item.late && (
                  <span className="shrink-0 rounded-full bg-[#E85A4F]/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.18em] text-[#E85A4F]">
                    {lateMin != null
                      ? t('overview.activityLateBadge', { n: lateMin })
                      : t('overview.activityLateBadgeGeneric')}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
