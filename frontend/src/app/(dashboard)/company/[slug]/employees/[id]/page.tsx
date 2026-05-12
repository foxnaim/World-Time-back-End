'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import useSWR from 'swr';
import { Badge, Card, cn } from '@tact/ui';
import { fetcher } from '@/lib/fetcher';
import { useLang } from '@/i18n/context';

// ---------------------------------------------------------------------------
// Backend shapes — kept in sync with CompanyService.getEmployeeDetail
//   GET /api/companies/:id/employees/:employeeId
// ---------------------------------------------------------------------------

type CompanyDetail = {
  id: string;
  slug: string;
  name: string;
  workStartHour: number;
};

type CheckInType = 'IN' | 'OUT';
type AbsenceType = 'VACATION' | 'SICK_LEAVE' | 'DAY_OFF' | 'BUSINESS_TRIP';

type EmployeeDetail = {
  id: string;
  name: string;
  position: string | null;
  role: 'OWNER' | 'MANAGER' | 'STAFF';
  status: 'ACTIVE' | 'INACTIVE';
  avatarUrl: string | null;
  monthlySalary: number | null;
  hourlyRate: number | null;
  departmentName: string | null;
  shiftName: string | null;
  stats: {
    avgArrivalMinutes: number | null;
    lateCountMonth: number;
    workedHoursMonth: number;
    vacationDaysThisYear: number;
  };
  arrivals30d: { date: string; firstInMinutes: number | null }[];
  recentCheckIns: { type: CheckInType; timestamp: string }[];
  absences: { type: AbsenceType; startDate: string; endDate: string; note: string | null }[];
};

function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-[#D8C3A5]/40', className)} />;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '');
}

/** Format minute-of-day -> "HH:MM"; null -> em dash. */
function fmtMinutes(m: number | null | undefined, fallback: string) {
  if (m == null) return fallback;
  const h = Math.floor(m / 60) % 24;
  const min = m % 60;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
}

function fmtTime(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(d);
}

function fmtCurrency(v: number | null | undefined, perHour = false) {
  if (v == null) return null;
  const nf = new Intl.NumberFormat('ru-RU');
  return `${nf.format(v)}${perHour ? ' ₸/ч' : ' ₸'}`;
}

function RoleBadge({ role }: { role: EmployeeDetail['role'] }) {
  return <Badge variant="sand">{role.toLowerCase()}</Badge>;
}

function StatusBadge({ status }: { status: EmployeeDetail['status'] }) {
  const { t } = useLang();
  if (status === 'ACTIVE') return <Badge variant="coral">{t('employees.statusActive')}</Badge>;
  return (
    <span className="inline-flex items-center rounded-full border border-[#E85A4F]/40 bg-[#E85A4F]/15 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.18em] text-[#E85A4F]">
      {t('employees.statusInactive')}
    </span>
  );
}

/** Simple CSS bar chart of first-arrival times over the last 30 days. */
function ArrivalChart({
  data,
  workStartHour,
}: {
  data: EmployeeDetail['arrivals30d'];
  workStartHour: number;
}) {
  // Scale: 0..max(minutes present, workStart+120). Bar height ∝ firstInMinutes.
  const present = data.map((d) => d.firstInMinutes).filter((m): m is number => m != null);
  const maxMin = Math.max(...present, (workStartHour + 2) * 60, 1);
  const lateCutoff = workStartHour * 60 + 30;
  return (
    <div className="flex items-end gap-1 h-40 w-full" role="img" aria-hidden="true">
      {data.map((d) => {
        if (d.firstInMinutes == null) {
          return (
            <div key={d.date} className="flex-1 h-full flex items-end">
              <div className="w-full rounded-t-sm bg-[#8E8D8A]/10" style={{ height: '6%' }} />
            </div>
          );
        }
        const pct = Math.max(4, Math.round((d.firstInMinutes / maxMin) * 100));
        const isLate = d.firstInMinutes > lateCutoff;
        return (
          <div
            key={d.date}
            className="flex-1 h-full flex items-end group relative"
            title={`${fmtDate(d.date)} · ${fmtMinutes(d.firstInMinutes, '—')}`}
          >
            <div
              className={cn(
                'w-full rounded-t-sm transition-colors',
                isLate ? 'bg-[#E85A4F]' : 'bg-[#E98074]/70',
              )}
              style={{ height: `${pct}%` }}
            />
          </div>
        );
      })}
    </div>
  );
}

function absenceLabel(t: (k: string) => string, type: AbsenceType) {
  switch (type) {
    case 'VACATION':
      return t('employees.absenceVacation');
    case 'SICK_LEAVE':
      return t('employees.absenceSickLeave');
    case 'DAY_OFF':
      return t('employees.absenceDayOff');
    case 'BUSINESS_TRIP':
      return t('employees.absenceBusinessTrip');
    default:
      return type;
  }
}

export default function EmployeeProfilePage() {
  const { t } = useLang();
  const params = useParams<{ slug: string; id: string }>();
  const slug = params?.slug;
  const employeeId = params?.id;

  const { data: company, error: companyErr } = useSWR<CompanyDetail>(
    slug ? `/api/companies/${slug}` : null,
    fetcher,
  );
  const companyId = company?.id;

  const { data, error, isLoading } = useSWR<EmployeeDetail>(
    companyId && employeeId ? `/api/companies/${companyId}/employees/${employeeId}` : null,
    fetcher,
  );

  const workStartHour = company?.workStartHour ?? 9;
  const noData = t('employees.noData');

  const backHref = slug ? `/company/${slug}/employees` : '#';

  // --- not found / error ---
  const notFound =
    (error && (error as { status?: number }).status === 404) ||
    (companyErr && (companyErr as { status?: number }).status === 404);

  return (
    <div className="flex flex-col gap-10">
      <div>
        <Link
          href={backHref}
          className="text-[10px] uppercase tracking-[0.24em] text-[#6b6966] hover:text-[#E98074] transition-colors"
        >
          {t('employees.backToList')}
        </Link>
      </div>

      {notFound ? (
        <div className="py-16 text-center">
          <div className="text-4xl text-[#6b6966]" style={{ fontFamily: 'Fraunces, serif' }}>
            {t('employees.notFound')}
          </div>
          <div className="mt-3">
            <Link href={backHref} className="text-sm text-[#E98074] hover:underline">
              {t('employees.backToList')}
            </Link>
          </div>
        </div>
      ) : error || companyErr ? (
        <div className="py-12 text-center text-sm text-[#E85A4F]">{t('employees.loadError')}</div>
      ) : isLoading || !data ? (
        <div className="flex flex-col gap-10">
          <div className="flex items-center gap-5">
            <Skeleton className="h-20 w-20 rounded-full" />
            <div className="flex flex-col gap-2">
              <Skeleton className="h-8 w-64" />
              <Skeleton className="h-4 w-40" />
            </div>
          </div>
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-40 w-full" />
            ))}
          </div>
          <Skeleton className="h-48 w-full" />
        </div>
      ) : (
        <>
          {/* Header */}
          <div className="flex items-start gap-5 flex-wrap">
            <span
              className="w-20 h-20 rounded-full bg-[#D8C3A5] text-[#3d3b38] flex items-center justify-center text-xl uppercase tracking-[0.18em] shrink-0 overflow-hidden"
              aria-hidden={data.avatarUrl ? undefined : 'true'}
            >
              {data.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={data.avatarUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                initials(data.name)
              )}
            </span>
            <div className="min-w-0 flex flex-col gap-2">
              <div className="text-[10px] uppercase tracking-[0.28em] text-[#6b6966]">
                {t('employees.profileEyebrow')}
              </div>
              <h1
                className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl tracking-tight text-[#3d3b38] leading-none"
                style={{ fontFamily: 'Fraunces, serif', fontWeight: 400 }}
              >
                {data.name}
              </h1>
              <div className="mt-1 flex items-center gap-2 flex-wrap">
                <RoleBadge role={data.role} />
                <StatusBadge status={data.status} />
                {data.position && (
                  <span className="text-sm text-[#3d3b38]">{data.position}</span>
                )}
              </div>
              <div className="text-[11px] uppercase tracking-[0.22em] text-[#6b6966]">
                {[data.departmentName, data.shiftName].filter(Boolean).join(' · ') ||
                  noData}
                {fmtCurrency(data.monthlySalary)
                  ? ` · ${fmtCurrency(data.monthlySalary)}`
                  : fmtCurrency(data.hourlyRate, true)
                    ? ` · ${fmtCurrency(data.hourlyRate, true)}`
                    : ''}
              </div>
            </div>
          </div>

          {/* KPI row */}
          <section className="grid gap-4 md:gap-5 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi
              eyebrow={t('employees.kpiAvgArrival')}
              value={fmtMinutes(data.stats.avgArrivalMinutes, noData)}
            />
            <Kpi
              eyebrow={t('employees.kpiLateMonth')}
              value={data.stats.lateCountMonth}
              accent={data.stats.lateCountMonth > 0}
            />
            <Kpi
              eyebrow={t('employees.kpiWorkedHours')}
              value={data.stats.workedHoursMonth}
              suffix={t('employees.kpiWorkedHoursSuffix')}
            />
            <Kpi
              eyebrow={t('employees.kpiVacationDays')}
              value={data.stats.vacationDaysThisYear}
            />
          </section>

          {/* 30-day arrival chart */}
          <Card className="p-6 md:p-7">
            <div className="text-[10px] uppercase tracking-[0.28em] text-[#6b6966]">
              {t('employees.arrivalChartTitle')}
            </div>
            <div className="mt-1 text-[11px] uppercase tracking-[0.18em] text-[#8E8D8A]">
              {t('employees.arrivalChartHint')}
            </div>
            <div className="mt-6">
              <ArrivalChart data={data.arrivals30d} workStartHour={workStartHour} />
            </div>
          </Card>

          {/* Two columns: recent check-ins + absences */}
          <section className="grid gap-6 lg:grid-cols-2">
            <Card className="p-6 md:p-7">
              <div className="text-[10px] uppercase tracking-[0.28em] text-[#6b6966]">
                {t('employees.recentCheckInsTitle')}
              </div>
              {data.recentCheckIns.length === 0 ? (
                <div className="mt-6 py-8 text-center text-sm text-[#6b6966]">
                  {t('employees.noCheckIns')}
                </div>
              ) : (
                <ul className="mt-4 flex flex-col">
                  {data.recentCheckIns.map((c, i) => (
                    <li
                      key={`${c.timestamp}-${i}`}
                      className={cn(
                        'flex items-center justify-between gap-3 py-3 text-sm',
                        i !== data.recentCheckIns.length - 1 && 'border-b border-[#8E8D8A]/15',
                      )}
                    >
                      <span className="inline-flex items-center gap-2">
                        <span
                          className={cn(
                            'w-2 h-2 rounded-full shrink-0',
                            c.type === 'IN' ? 'bg-[#4CAF50]' : 'bg-[#8E8D8A]',
                          )}
                          aria-hidden="true"
                        />
                        <span className="text-[11px] uppercase tracking-[0.2em] text-[#3d3b38]">
                          {c.type === 'IN' ? t('employees.checkInIn') : t('employees.checkInOut')}
                        </span>
                      </span>
                      <span className="text-[#6b6966] tabular-nums">
                        {fmtDate(c.timestamp)} · {fmtTime(c.timestamp)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card className="p-6 md:p-7">
              <div className="text-[10px] uppercase tracking-[0.28em] text-[#6b6966]">
                {t('employees.absencesTitle')}
              </div>
              {data.absences.length === 0 ? (
                <div className="mt-6 py-8 text-center text-sm text-[#6b6966]">
                  {t('employees.noAbsences')}
                </div>
              ) : (
                <ul className="mt-4 flex flex-col">
                  {data.absences.map((a, i) => (
                    <li
                      key={`${a.startDate}-${i}`}
                      className={cn(
                        'flex flex-col gap-1 py-3 text-sm',
                        i !== data.absences.length - 1 && 'border-b border-[#8E8D8A]/15',
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-[11px] uppercase tracking-[0.2em] text-[#3d3b38]">
                          {absenceLabel(t, a.type)}
                        </span>
                        <span className="text-[#6b6966] tabular-nums">
                          {fmtDate(a.startDate)} — {fmtDate(a.endDate)}
                        </span>
                      </div>
                      {a.note && <div className="text-[#6b6966]">{a.note}</div>}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </section>
        </>
      )}
    </div>
  );
}

/** Local KPI card matching the editorial KpiCard look without the delta row. */
function Kpi({
  eyebrow,
  value,
  suffix,
  accent,
}: {
  eyebrow: string;
  value: React.ReactNode;
  suffix?: string;
  accent?: boolean;
}) {
  return (
    <Card className="flex flex-col justify-between min-h-[160px] p-6 md:p-7">
      <div className="text-[10px] uppercase tracking-[0.28em] text-[#3d3b38]">{eyebrow}</div>
      <div className="mt-5 flex items-baseline gap-2">
        <span
          className={cn(
            'text-5xl md:text-6xl leading-none tracking-tight',
            accent ? 'text-[#E85A4F]' : 'text-[#3d3b38]',
          )}
          style={{ fontFamily: 'Fraunces, serif', fontWeight: 400 }}
        >
          {value}
        </span>
        {suffix && (
          <span className="text-xs uppercase tracking-[0.24em] text-[#6b6966]">{suffix}</span>
        )}
      </div>
    </Card>
  );
}
