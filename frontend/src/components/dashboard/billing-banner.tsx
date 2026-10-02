'use client';

import Link from 'next/link';
import useSWR from 'swr';
import { fetcher } from '@/lib/fetcher';

/**
 * Banner shown at the top of any company page when the subscription is
 * PAST_DUE, CANCELED, or expiring within 7 days. Owner-only endpoint — for
 * non-owners the /billing/my/:id call 403s and SWR gives us no data, so the
 * banner stays hidden. That matches the intent: only the billing contact
 * needs to see this.
 */
type Sub = {
  subscription: {
    tier: 'FREE' | 'TEAM' | 'ENTERPRISE';
    status: 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'TRIALING';
    currentPeriodEnd: string;
  };
};

function daysLeft(iso: string): number {
  const diff = new Date(iso).getTime() - Date.now();
  return Math.ceil(diff / (24 * 60 * 60 * 1000));
}

export function BillingBanner({
  companyId,
  companySlug,
}: {
  companyId: string | null;
  companySlug: string | null;
}) {
  const { data } = useSWR<Sub>(
    companyId ? `/api/billing/my/${companyId}` : null,
    fetcher,
    { revalidateOnFocus: false },
  );

  if (!data || !companySlug) return null;

  const { status, currentPeriodEnd, tier } = data.subscription;
  const left = daysLeft(currentPeriodEnd);
  const expiresSoon = status === 'ACTIVE' && left <= 7 && tier !== 'FREE';

  if (status === 'ACTIVE' && !expiresSoon) return null;
  if (status === 'TRIALING') return null;

  const message =
    status === 'PAST_DUE'
      ? 'Подписка просрочена. Некоторые функции могут быть ограничены.'
      : status === 'CANCELED'
        ? 'Подписка отменена. Компания работает на тарифе FREE.'
        : left <= 0
          ? 'Срок подписки истёк сегодня.'
          : `Подписка истекает через ${left} ${left === 1 ? 'день' : 'дн.'}`;

  return (
    <div
      role="status"
      className="mb-6 rounded-md border border-[#E98074]/40 bg-[#E98074]/5 px-4 py-3 flex items-center justify-between gap-4 text-sm text-[#3d3b38]"
    >
      <span>
        <span className="uppercase tracking-[0.22em] text-[10px] text-[#E98074] mr-2">
          Подписка
        </span>
        {message}
      </span>
      <Link
        href={`/company/${companySlug}/billing`}
        className="shrink-0 text-xs uppercase tracking-[0.22em] px-3 py-1.5 rounded-md border border-[#E98074]/50 text-[#E98074] hover:bg-[#E98074]/10 transition-colors"
      >
        Открыть
      </Link>
    </div>
  );
}
