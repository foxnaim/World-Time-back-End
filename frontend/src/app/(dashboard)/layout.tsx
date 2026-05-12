'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname, useRouter, useParams } from 'next/navigation';
import useSWR, { useSWRConfig } from 'swr';
import { fetcher } from '@/lib/fetcher';
import { api } from '@/lib/api';
import { clearAuthCookies } from '@/lib/auth-cookie';
import { BillingBanner } from '@/components/dashboard/billing-banner';
import { useLang } from '@/i18n/context';

type Company = {
  id: string;
  slug: string;
  name: string;
};

type SubscriptionTier = 'FREE' | 'TEAM' | 'ENTERPRISE';
type SubscriptionStatus =
  | 'ACTIVE'
  | 'TRIALING'
  | 'PAST_DUE'
  | 'CANCELED'
  | 'EXPIRED'
  | 'INCOMPLETE';

type MeSubscription = {
  companyId: string;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  seatsLimit?: number | null;
  currentPeriodEnd?: string | null;
};

type MeEmployee = {
  role: 'OWNER' | 'MANAGER' | 'ACCOUNTANT' | 'HR' | 'STAFF' | 'ADMIN' | 'EMPLOYEE' | string;
  company: { id: string; name: string; slug: string };
};

/**
 * Sidebar items each company role is allowed to see. OWNER/MANAGER (and any
 * unrecognised legacy role) fall through to the full list.
 */
const COMPANY_NAV_BY_ROLE: Record<string, string[]> = {
  ACCOUNTANT: ['', '/reports', '/timesheet', '/payroll', '/billing'],
  HR: ['', '/employees', '/absences'],
};

type Me = {
  id: string;
  telegramId: string;
  firstName: string;
  lastName: string | null;
  username: string | null;
  phone: string | null;
  avatarUrl: string | null;
  accountType?: 'FREELANCER' | 'COMPANY' | null;
  employees?: MeEmployee[];
  subscriptions?: MeSubscription[];
  /**
   * Optional platform-level super-admin flag. The /auth/me endpoint is being
   * extended to expose this; until it lands we probe /api/admin/stats as a
   * fallback (see `useIsSuperAdmin` below).
   */
  isSuperAdmin?: boolean;
};

/**
 * Resolve platform super-admin status for the sidebar gate.
 *
 * Resolution order:
 *   1. `me.isSuperAdmin === true` — once /auth/me exposes the flag, this
 *      short-circuits without any extra request.
 *   2. Probe `/api/admin/stats` via SWR. The backend enforces the super-
 *      admin gate on that route, so:
 *        - 2xx → user is super-admin → show link
 *        - 401/403 (or any error) → hide link (fail closed)
 *      We use the probe because `/auth/me` does not yet expose
 *      `isSuperAdmin`; that extension is in-flight. Once it lands the flag
 *      path takes over with no network change.
 *
 * Note: company-level OWNER/ADMIN roles on `me.employees` are intentionally
 * NOT treated as platform super-admin — the /admin area requires the
 * platform-level role, which the backend checks regardless of the sidebar's
 * decision.
 */
function useIsSuperAdmin(me: Me | undefined): boolean {
  const flagFromMe = me?.isSuperAdmin === true;

  // Only probe when we have a loaded `me` and the flag isn't already true.
  // Gating on `me` avoids firing the probe before auth hydrates (which would
  // otherwise produce a spurious 401 during initial load that we'd then
  // have to debounce).
  const shouldProbe = Boolean(me) && !flagFromMe;

  const { data } = useSWR<{ isSuperAdmin: boolean }>(
    shouldProbe ? '/api/admin/whoami' : null,
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateIfStale: false,
      shouldRetryOnError: false,
    },
  );

  if (flagFromMe) return true;
  return data?.isSuperAdmin === true;
}

function formatDisplayName(me: Me | undefined, fallback: string): string {
  if (!me) return fallback;
  const full = [me.firstName, me.lastName].filter(Boolean).join(' ').trim();
  return full || me.username || fallback;
}

function formatSecondary(me: Me | undefined): string {
  if (!me) return '';
  if (me.phone) return me.phone;
  if (me.username) return `@${me.username}`;
  return `id ${me.telegramId}`;
}

function formatInitials(me: Me | undefined): string {
  if (!me) return 'AO';
  const a = (me.firstName?.[0] ?? '').toUpperCase();
  const b = (me.lastName?.[0] ?? me.username?.[0] ?? '').toUpperCase();
  const combined = (a + b).slice(0, 2);
  return combined || 'AO';
}

function classNames(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(' ');
}

function currentYearMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function MonthBadge({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const items = React.useMemo(() => {
    const now = new Date();
    const arr: { value: string; label: string }[] = [];
    for (let i = 0; i < 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('ru-RU', {
        month: 'long',
        year: 'numeric',
      });
      arr.push({ value: v, label });
    }
    return arr;
  }, []);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 border border-[#8E8D8A]/30 bg-transparent px-3 h-9 rounded-full text-xs uppercase tracking-[0.22em] text-[#3d3b38] hover:text-[#E98074] hover:border-[#E98074]/50 transition-colors"
      >
        <span aria-hidden className="w-1 h-1 rounded-full bg-[#E98074]" />
        {month}
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-30 w-56 border border-[#8E8D8A]/20 bg-[#EAE7DC] shadow-xl rounded-xl py-2">
          {items.map((it) => (
            <button
              key={it.value}
              onClick={() => {
                onChange(it.value);
                setOpen(false);
              }}
              className={classNames(
                'w-full flex items-center justify-between px-4 py-2 text-sm text-left',
                it.value === month ? 'text-[#E98074]' : 'text-[#3d3b38] hover:text-[#E98074]',
              )}
            >
              <span className="capitalize">{it.label}</span>
              <span className="text-[10px] tracking-[0.2em]">{it.value}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CompanySwitcher({ companies, activeSlug }: { companies: Company[]; activeSlug?: string }) {
  const router = useRouter();
  const { t } = useLang();
  const { mutate } = useSWRConfig();
  const [open, setOpen] = React.useState(false);
  const [confirmCompany, setConfirmCompany] = React.useState<Company | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const active = companies.find((c) => c.slug === activeSlug) ?? companies[0] ?? null;

  const deleteCompany = async () => {
    if (!confirmCompany) return;
    const c = confirmCompany;
    setDeleting(true);
    try {
      await api.delete(`/api/companies/${c.id}`);
      await mutate('/api/companies/my');
      setConfirmCompany(null);
      setOpen(false);
      if (c.slug === activeSlug) {
        const remaining = companies.filter((x) => x.id !== c.id);
        router.push(remaining[0] ? `/company/${remaining[0].slug}` : '/dashboard');
      }
    } catch (err) {
      alert((err as Error)?.message ?? t('settings.deleteError'));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      {/* Delete confirm modal */}
      {confirmCompany && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => !deleting && setConfirmCompany(null)}
        >
          <div
            className="w-[360px] mx-4 bg-[#EAE7DC] rounded-2xl shadow-2xl border border-[#8E8D8A]/20 p-6 flex flex-col gap-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <div className="text-[10px] uppercase tracking-[0.28em] text-[#E85A4F] mb-2">
                {t('settings.dangerZone')}
              </div>
              <h2
                className="text-2xl tracking-tight text-[#3d3b38]"
                style={{ fontFamily: 'Fraunces, serif', fontWeight: 400 }}
              >
                {confirmCompany.name}
              </h2>
            </div>
            <p className="text-sm text-[#3d3b38]/70 leading-relaxed">
              {t('settings.deleteCompanyHint')}
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setConfirmCompany(null)}
                disabled={deleting}
                className="px-4 py-2 text-xs uppercase tracking-[0.22em] text-[#6b6966] hover:text-[#3d3b38] transition-colors disabled:opacity-40"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={deleteCompany}
                disabled={deleting}
                className="px-5 py-2 text-xs uppercase tracking-[0.22em] rounded-full bg-[#E85A4F] text-white hover:bg-[#d44f44] transition-colors disabled:opacity-40"
              >
                {deleting ? '…' : t('common.delete')}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-3 border border-[#8E8D8A]/30 bg-transparent pl-3 pr-4 h-9 rounded-full text-sm text-[#3d3b38] hover:text-[#E98074] hover:border-[#E98074]/50 transition-colors"
      >
        <span className="w-2 h-2 rounded-full bg-[#E98074]/70" />
        <span className="tracking-tight truncate max-w-[120px] sm:max-w-none" style={{ fontFamily: 'Fraunces, serif' }}>
          {active?.name ?? t('dashboard.companyFallback')}
        </span>
        <span aria-hidden className="text-[#6b6966]/70 text-xs">
          ▾
        </span>
      </button>
      {open && (
        <div className="absolute left-0 top-11 z-30 w-[calc(100vw-2rem)] sm:w-72 border border-[#8E8D8A]/20 bg-[#EAE7DC] shadow-xl rounded-xl py-2">
          {companies.length === 0 ? (
            <div className="px-4 py-3 text-sm text-[#6b6966]">{t('dashboard.noCompaniesShort')}</div>
          ) : (
            companies.map((c) => (
              <div key={c.id} className="flex items-center">
                <button
                  onClick={() => {
                    setOpen(false);
                    router.push(`/company/${c.slug}`);
                  }}
                  className={classNames(
                    'flex-1 text-left px-4 py-2 text-sm flex items-center justify-between',
                    c.slug === activeSlug ? 'text-[#E98074]' : 'text-[#3d3b38] hover:text-[#E98074]',
                  )}
                >
                  <span className="tracking-tight" style={{ fontFamily: 'Fraunces, serif' }}>
                    {c.name}
                  </span>
                  <span className="text-[10px] uppercase tracking-[0.2em] text-[#6b6966]/70">
                    /{c.slug}
                  </span>
                </button>
                <button
                  onClick={() => { setOpen(false); setConfirmCompany(c); }}
                  className="shrink-0 px-3 py-2 text-[#6b6966]/40 hover:text-[#E85A4F] transition-colors"
                  title={t('settings.deleteCompany')}
                >
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="1,3 12,3"/>
                    <path d="M4.5 3V2a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 .5.5v1"/>
                    <path d="M2.5 3l.7 8a.5.5 0 0 0 .5.5h5.6a.5.5 0 0 0 .5-.5l.7-8"/>
                  </svg>
                </button>
              </div>
            ))
          )}
          <div className="border-t border-[#8E8D8A]/15 mt-1 pt-1">
            <button
              onClick={() => {
                setOpen(false);
                router.push('/onboarding/company');
              }}
              className="w-full text-left px-4 py-2 text-sm flex items-center gap-2 text-[#E98074] hover:bg-[#E98074]/10"
            >
              <span aria-hidden className="text-base leading-none">＋</span>
              <span
                className="tracking-tight"
                style={{ fontFamily: 'Fraunces, serif' }}
              >
                {t('dashboard.addCompany')}
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
    </>
  );
}

/**
 * Pick the "active" owner company for badge display.
 *
 * Rule: first employees[] entry whose role === 'OWNER'. We deliberately rely
 * on the ordering that the backend returns rather than sorting on slug — the
 * rest of the dashboard (CompanySwitcher) also uses the first entry as the
 * default, so this keeps the badge aligned with what's actually shown in the
 * header.
 */
function pickOwnerCompanyId(me: Me | undefined): string | null {
  const ownerEmp = me?.employees?.find((e) => e.role === 'OWNER');
  return ownerEmp?.company.id ?? null;
}

/**
 * Returns the subscription record for the given companyId, or null when the
 * company has no subscription row yet (pre-FREE seed, or endpoint still
 * deploying). Callers should treat null as "nothing to render".
 */
function findSubscription(
  me: Me | undefined,
  companyId: string | null,
): MeSubscription | null {
  if (!me?.subscriptions || !companyId) return null;
  return me.subscriptions.find((s) => s.companyId === companyId) ?? null;
}

function tierLabel(tier: SubscriptionTier): string {
  switch (tier) {
    case 'FREE':
      return 'FREE';
    case 'TEAM':
      return 'TEAM';
    case 'ENTERPRISE':
      return 'ENTERPRISE';
    default:
      return tier;
  }
}

/**
 * Localized, human-friendly status line. Returns null for ACTIVE / TRIALING
 * because those are the "happy path" and rendering a status line under the
 * badge is noisy. Non-happy states are surfaced with muted-coral so the owner
 * actually notices them.
 */
function statusLabel(
  status: SubscriptionStatus,
  t: (key: string) => string,
): string | null {
  switch (status) {
    case 'ACTIVE':
    case 'TRIALING':
      return null;
    case 'PAST_DUE':
      return t('dashboard.statusPastDue');
    case 'CANCELED':
      return t('dashboard.statusCanceled');
    case 'EXPIRED':
      return t('dashboard.statusExpired');
    case 'INCOMPLETE':
      return t('dashboard.statusIncomplete');
    default:
      return status;
  }
}

function TierBadge({ sub }: { sub: MeSubscription }) {
  const label = tierLabel(sub.tier);
  const warn =
    sub.status === 'PAST_DUE' ||
    sub.status === 'EXPIRED' ||
    sub.status === 'CANCELED' ||
    sub.status === 'INCOMPLETE';
  return (
    <span
      className={classNames(
        'inline-flex items-center gap-1 px-2 h-5 rounded-full border text-[10px] uppercase tracking-[0.22em]',
        warn
          ? 'border-[#E85A4F]/60 text-[#E85A4F] bg-[#E85A4F]/10'
          : 'border-[#E98074]/50 text-[#E98074] bg-[#E98074]/10',
      )}
      title={sub.status}
    >
      <span aria-hidden className="w-1 h-1 rounded-full bg-[#E98074]" />
      {label}
    </span>
  );
}

function UserMenu() {
  const router = useRouter();
  const { t } = useLang();
  const [open, setOpen] = React.useState(false);
  const [loggingOut, setLoggingOut] = React.useState(false);
  const { data: me } = useSWR<Me>('/api/auth/me', fetcher);
  const accountFallback = t('dashboard.account');
  const displayName = formatDisplayName(me, accountFallback);
  const secondary = formatSecondary(me);
  const initials = formatInitials(me);
  const buttonLabel = me?.username ? `@${me.username}` : accountFallback;

  const ownerCompanyId = pickOwnerCompanyId(me);
  const ownerCompany = me?.employees?.find(
    (e) => e.role === 'OWNER' && e.company.id === ownerCompanyId,
  )?.company;
  const subscription = findSubscription(me, ownerCompanyId);
  const statusNote = subscription ? statusLabel(subscription.status, t) : null;

  const onProfile = () => {
    setOpen(false);
    router.push('/profile');
  };

  const onLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      // Best-effort: don't block logout on server/network failure.
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          credentials: 'include',
        });
      } catch {
        /* ignore */
      }
      clearAuthCookies();
      setOpen(false);
      router.push('/');
      router.refresh();
    } finally {
      setLoggingOut(false);
    }
  };
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 h-9 pl-1 pr-3 rounded-full border border-[#8E8D8A]/30 hover:border-[#E98074]/50 hover:text-[#E98074] text-[#3d3b38] transition-colors"
      >
        {me?.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={me.avatarUrl}
            alt=""
            className="w-7 h-7 rounded-full object-cover"
          />
        ) : (
          <span className="w-7 h-7 rounded-full bg-[#D8C3A5] flex items-center justify-center text-[11px] tracking-wider text-[#3d3b38]">
            {initials}
          </span>
        )}
        <span className="text-xs uppercase tracking-[0.22em] truncate max-w-[160px]">
          {buttonLabel}
        </span>
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-30 w-60 border border-[#8E8D8A]/20 bg-[#EAE7DC] shadow-xl rounded-xl py-2 text-sm text-[#3d3b38]">
          <div className="px-4 py-3 border-b border-[#8E8D8A]/15">
            <div
              className="text-base tracking-tight truncate text-[#2a2927]"
              style={{ fontFamily: 'Fraunces, serif' }}
            >
              {displayName}
            </div>
            {secondary && (
              <div className="text-xs text-[#6b6966] mt-0.5 truncate">{secondary}</div>
            )}
            {ownerCompany && subscription && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  router.push(`/company/${ownerCompany.slug}/billing`);
                }}
                className="mt-2 flex items-center gap-2 min-w-0 w-full text-left hover:text-[#E98074] transition-colors"
                title={t('dashboard.manageSubscription')}
              >
                <span
                  className="text-xs text-[#3d3b38] truncate"
                  style={{ fontFamily: 'Fraunces, serif' }}
                >
                  {ownerCompany.name}
                </span>
                <TierBadge sub={subscription} />
              </button>
            )}
            {ownerCompany && subscription && statusNote && (
              <div className="text-[10px] uppercase tracking-[0.22em] text-[#E85A4F] mt-1">
                {statusNote}
              </div>
            )}
          </div>
          {ownerCompany && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                router.push(`/company/${ownerCompany.slug}/billing`);
              }}
              className="w-full text-left px-4 py-2 text-[#3d3b38] hover:text-[#E98074]"
            >
              {t('dashboard.subscription')}
            </button>
          )}
          <button
            type="button"
            onClick={onProfile}
            className="w-full text-left px-4 py-2 text-[#3d3b38] hover:text-[#E98074]"
          >
            {t('dashboard.profile')}
          </button>
          <button
            type="button"
            onClick={onLogout}
            disabled={loggingOut}
            className="w-full text-left px-4 py-2 text-[#3d3b38] hover:text-[#E85A4F] disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loggingOut ? t('dashboard.loggingOut') : t('dashboard.logout')}
          </button>
        </div>
      )}
    </div>
  );
}

const COMPANY_NAV = [
  { href: '', labelKey: 'dashboard.navOverview' },
  { href: '/employees', labelKey: 'dashboard.navEmployees' },
  { href: '/absences', labelKey: 'dashboard.navAbsences' },
  { href: '/reports', labelKey: 'dashboard.navReports' },
  { href: '/timesheet', labelKey: 'dashboard.navTimesheet' },
  { href: '/payroll', labelKey: 'dashboard.navPayroll' },
  { href: '/qr', labelKey: 'dashboard.navQr' },
  { href: '/billing', labelKey: 'dashboard.navBilling' },
  { href: '/settings', labelKey: 'dashboard.navSettings' },
] as const;

const FREELANCE_NAV = [
  { href: '/freelance', labelKey: 'dashboard.navTimer' },
  { href: '/freelance/projects', labelKey: 'dashboard.navProjects' },
  { href: '/freelance/stats', labelKey: 'dashboard.navStats' },
  { href: '/freelance/billing', labelKey: 'dashboard.navBilling' },
] as const;

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ slug?: string }>();
  const pathname = usePathname();
  const _router = useRouter();
  const { t } = useLang();
  const slug = params?.slug;

  const {
    data: companies,
    error: companiesError,
    isLoading: companiesLoading,
  } = useSWR<Company[]>('/api/companies/my', fetcher);

  // `me` is already fetched inside `UserMenu`; SWR dedupes the key so this
  // second hook reuses the same cache entry without an extra network call.
  const { data: me } = useSWR<Me>('/api/auth/me', fetcher);
  const isSuperAdmin = useIsSuperAdmin(me);

  const [mobileOpen, setMobileOpen] = React.useState(false);

  const [month, setMonth] = React.useState<string>(currentYearMonth);

  // Sync month from URL on mount (after hydration), then keep URL in sync
  React.useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const m = sp.get('month');
    if (m && m !== month) setMonth(m);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('month', month);
    window.history.replaceState({}, '', url);
  }, [month]);

  const activeSlug = slug ?? companies?.[0]?.slug;
  const activeCompany = companies?.find((c) => c.slug === activeSlug) ?? null;
  // The caller's role within the currently-active company (if any), used to
  // filter the sidebar. Falls back to undefined → full nav.
  const activeCompanyRole = me?.employees?.find(
    (e) => e.company.slug === activeSlug,
  )?.role;
  const allowedNavHrefs = activeCompanyRole
    ? COMPANY_NAV_BY_ROLE[activeCompanyRole]
    : undefined;
  const visibleCompanyNav = allowedNavHrefs
    ? COMPANY_NAV.filter((item) => allowedNavHrefs.includes(item.href))
    : COMPANY_NAV;
  const isFreelance = pathname?.startsWith('/freelance') ?? false;
  // Sidebar-section visibility follows the user's chosen accountType. Owner
  // of a company always sees the company section too (needed for seeded
  // demo accounts and for users who later created a company). Until /auth/me
  // responds, show both sections so nothing flashes empty.
  const accountType = me?.accountType ?? null;
  const ownsCompany = Boolean(me?.employees?.some((e) => e.role === 'OWNER'));
  const showCompanySection = accountType === null || accountType === 'COMPANY' || ownsCompany;
  const showFreelanceSection = accountType === null || accountType === 'FREELANCER';

  return (
    <div className="h-screen bg-[#EAE7DC] text-[#3d3b38] flex overflow-hidden">
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        className={classNames(
          'fixed inset-y-0 left-0 z-40 w-[240px] shrink-0 border-r border-[#8E8D8A]/20 bg-[#EAE7DC] flex flex-col transition-transform duration-200',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          'md:relative md:translate-x-0 md:flex',
        )}
        aria-label="Navigation"
      >
        <div className="h-16 flex items-center px-6 border-b border-[#8E8D8A]/15">
          <Link
            href="/"
            className="text-[#3d3b38] hover:text-[#E98074] transition-colors tracking-tight text-lg"
            style={{ fontFamily: 'Fraunces, serif' }}
          >
            Work Tact
          </Link>
        </div>
        <nav className="p-4 flex flex-col gap-1 flex-1 min-h-0 overflow-y-auto">
          {showCompanySection && (
          <div className="px-3 py-2 text-[10px] uppercase tracking-[0.28em] text-[#6b6966]">
            {t('dashboard.sectionCompany')}
          </div>
          )}
          {showCompanySection && (companiesError ? (
            <div className="px-3 py-2 flex flex-col gap-2">
              <p className="text-xs text-[#E85A4F]/90 leading-relaxed">
                {t('dashboard.loadCompaniesError')}
              </p>
              <Link
                href="/onboarding/company"
                className="inline-flex items-center justify-center px-3 py-2 text-xs uppercase tracking-[0.22em] rounded-md border border-[#E98074]/50 text-[#E98074] hover:bg-[#E98074]/10 transition-colors"
              >
                {t('dashboard.createCompany')}
              </Link>
            </div>
          ) : !companiesLoading && companies && companies.length === 0 ? (
            <div className="px-3 py-2 flex flex-col gap-2">
              <p className="text-xs text-[#6b6966] leading-relaxed">
                {t('dashboard.noCompaniesSidebar')}
              </p>
              <Link
                href="/onboarding/company"
                className="inline-flex items-center justify-center px-3 py-2 text-xs uppercase tracking-[0.22em] rounded-md border border-[#E98074]/50 text-[#E98074] hover:bg-[#E98074]/10 transition-colors"
              >
                {t('dashboard.createShort')}
              </Link>
            </div>
          ) : (
            visibleCompanyNav.map((item) => {
              const disabled = !activeSlug;
              const href = activeSlug ? `/company/${activeSlug}${item.href}` : '#';
              const isActive =
                !disabled &&
                !isFreelance &&
                (pathname === href ||
                  (item.href === '' && pathname === `/company/${activeSlug}`) ||
                  (item.href !== '' && pathname?.startsWith(href)));
              const label = t(item.labelKey);
              return (
                <Link
                  key={item.labelKey}
                  href={href}
                  aria-disabled={disabled || undefined}
                  title={disabled ? t('dashboard.loadingCompanies') : undefined}
                  onClick={(e) => {
                    if (disabled || href === '#') {
                      e.preventDefault();
                    }
                    setMobileOpen(false);
                  }}
                  className={classNames(
                    'px-3 py-2 rounded-md text-sm tracking-tight flex items-center justify-between',
                    'transition-colors',
                    disabled && 'opacity-40 pointer-events-auto cursor-not-allowed',
                    isActive
                      ? 'text-[#E98074] bg-[#E98074]/10'
                      : 'text-[#3d3b38] hover:text-[#E98074]',
                  )}
                >
                  <span>{label}</span>
                  {isActive && <span className="w-1 h-1 rounded-full bg-[#E98074]" />}
                </Link>
              );
            })
          ))}
          {showFreelanceSection && (
          <div className="px-3 pt-5 pb-2 text-[10px] uppercase tracking-[0.28em] text-[#6b6966]">
            {t('dashboard.sectionFreelance')}
          </div>
          )}
          {showFreelanceSection && FREELANCE_NAV.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== '/freelance' && pathname?.startsWith(item.href)) ||
              (item.href === '/freelance' && pathname === '/freelance');
            const label = t(item.labelKey);
            return (
              <Link
                key={item.labelKey}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={classNames(
                  'px-3 py-2 rounded-md text-sm tracking-tight flex items-center justify-between',
                  'transition-colors',
                  isActive
                    ? 'text-[#E98074] bg-[#E98074]/10'
                    : 'text-[#3d3b38] hover:text-[#E98074]',
                )}
              >
                <span>{label}</span>
                {isActive && <span className="w-1 h-1 rounded-full bg-[#E98074]" />}
              </Link>
            );
          })}
          {isSuperAdmin && (
            <>
              <div className="px-3 pt-5 pb-2 text-[10px] uppercase tracking-[0.28em] text-[#6b6966]">
                {t('dashboard.platform')}
              </div>
              {(() => {
                const isActive = pathname === '/admin' || pathname?.startsWith('/admin/');
                return (
                  <Link
                    href="/admin"
                    onClick={() => setMobileOpen(false)}
                    className={classNames(
                      'px-3 py-2 rounded-md text-sm tracking-tight flex items-center justify-between',
                      'transition-colors',
                      isActive
                        ? 'text-[#E98074] bg-[#E98074]/10'
                        : 'text-[#3d3b38] hover:text-[#E98074]',
                    )}
                  >
                    <span>Admin</span>
                    {isActive && <span className="w-1 h-1 rounded-full bg-[#E98074]" />}
                  </Link>
                );
              })()}
            </>
          )}
        </nav>
        <div className="mt-auto px-6 py-5 border-t border-[#8E8D8A]/15 text-[10px] uppercase tracking-[0.28em] text-[#6b6966]/60">
          v0.1 · editorial
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        <header className="h-16 shrink-0 border-b border-[#8E8D8A]/15 px-4 md:px-8 flex items-center justify-between gap-6 sticky top-0 z-20 bg-[#EAE7DC]/90 backdrop-blur">
          <div className="flex items-center gap-4">
            <button
              className="md:hidden p-2 text-[#3d3b38] hover:text-[#E98074]"
              onClick={() => setMobileOpen(v => !v)}
              aria-label="Меню"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M2 5h16M2 10h16M2 15h16"/>
              </svg>
            </button>
            {!isFreelance && (
              <CompanySwitcher companies={companies ?? []} activeSlug={activeSlug} />
            )}
            {isFreelance && (
              <div
                className="text-sm tracking-tight text-[#3d3b38]"
                style={{ fontFamily: 'Fraunces, serif' }}
              >
                {t('dashboard.freelance')}
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            {!isFreelance && <MonthBadge month={month} onChange={setMonth} />}
            <UserMenu />
          </div>
        </header>
        <main className="flex-1 px-4 py-6 sm:px-6 sm:py-8 md:px-12 md:py-12 max-w-[1400px] w-full mx-auto">
          {activeCompany && !isFreelance && pathname?.startsWith('/company/') && (
            <BillingBanner
              companyId={activeCompany.id}
              companySlug={activeCompany.slug}
            />
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
