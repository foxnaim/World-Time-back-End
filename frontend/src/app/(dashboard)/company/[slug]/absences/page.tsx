'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import useSWR from 'swr';
import { cn } from '@tact/ui';
import { fetcher } from '@/lib/fetcher';
import { api } from '@/lib/api';
import { MonthPicker } from '@/components/dashboard/company/month-picker';
import { useLang } from '@/i18n/context';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CompanyDetail = { id: string; slug: string; name: string };

type AbsenceType = 'VACATION' | 'SICK_LEAVE' | 'DAY_OFF' | 'BUSINESS_TRIP';
type AbsenceStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

type Absence = {
  id: string;
  employeeId: string;
  employeeName: string;
  type: AbsenceType;
  status: AbsenceStatus;
  startDate: string;
  endDate: string;
  note: string | null;
  approvedById: string | null;
  createdAt: string;
};

type EmployeeItem = {
  id: string;
  name: string;
  position?: string | null;
  status?: string;
};

type EmployeesResp = { items: EmployeeItem[] };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function currentYearMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-[#D8C3A5]/40', className)} />;
}

function TypeBadge({ type, label }: { type: AbsenceType; label: string }) {
  const colorMap: Record<AbsenceType, string> = {
    VACATION: 'border-[#E98074]/60 text-[#E98074] bg-[#E98074]/10',
    SICK_LEAVE: 'border-[#E85A4F]/60 text-[#E85A4F] bg-[#E85A4F]/10',
    DAY_OFF: 'border-[#8E8D8A]/50 text-[#6b6966] bg-[#8E8D8A]/10',
    BUSINESS_TRIP: 'border-[#D8C3A5]/80 text-[#3d3b38] bg-[#D8C3A5]/40',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 h-5 rounded-full border text-[10px] uppercase tracking-[0.2em]',
        colorMap[type],
      )}
    >
      {label}
    </span>
  );
}

function StatusBadge({ status, label }: { status: AbsenceStatus; label: string }) {
  const colorMap: Record<AbsenceStatus, string> = {
    PENDING: 'border-[#E98074]/60 text-[#E98074] bg-[#E98074]/10',
    APPROVED: 'border-[#8E8D8A]/50 text-[#5a7d5a] bg-[#8E8D8A]/10',
    REJECTED: 'border-[#E85A4F]/60 text-[#E85A4F] bg-[#E85A4F]/10',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 h-5 rounded-full border text-[10px] uppercase tracking-[0.2em]',
        colorMap[status],
      )}
    >
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function AbsencesPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug;
  const { t } = useLang();
  // Month state — initialise from ?month= URL param, fall back to current month.
  const [month, setMonth] = React.useState<string>(() => {
    if (typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search);
      return sp.get('month') || currentYearMonth();
    }
    return currentYearMonth();
  });

  // Form visibility + state
  const [formOpen, setFormOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<{
    employeeId: string;
    type: AbsenceType | '';
    startDate: string;
    endDate: string;
    note: string;
  }>({
    employeeId: '',
    type: '',
    startDate: '',
    endDate: '',
    note: '',
  });

  // Per-row delete tracking
  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  // Fetch company by slug
  const { data: company, error: companyErr } = useSWR<CompanyDetail>(
    slug ? `/api/companies/${slug}` : null,
    fetcher,
  );
  const companyId = company?.id;

  // Fetch absences for the company (month-filtered)
  const absencesKey = companyId ? `/api/companies/${companyId}/absences?month=${month}` : null;
  const {
    data: absences,
    error: absencesErr,
    isLoading,
    mutate,
  } = useSWR<Absence[]>(absencesKey, fetcher);

  // Fetch employees for the form dropdown
  const { data: employeesResp } = useSWR<EmployeesResp>(
    companyId ? `/api/companies/${companyId}/employees` : null,
    fetcher,
  );
  const employees = employeesResp?.items ?? [];

  // Absence type label map
  const typeLabels: Record<AbsenceType, string> = {
    VACATION: t('absences.typeVacation'),
    SICK_LEAVE: t('absences.typeSickLeave'),
    DAY_OFF: t('absences.typeDayOff'),
    BUSINESS_TRIP: t('absences.typeBusinessTrip'),
  };

  // Absence status label map
  const statusLabels: Record<AbsenceStatus, string> = {
    PENDING: t('absences.statusPending'),
    APPROVED: t('absences.statusApproved'),
    REJECTED: t('absences.statusRejected'),
  };

  // Per-row decision tracking (approve/reject pending requests)
  const [decidingId, setDecidingId] = React.useState<string | null>(null);

  // Update URL when month changes
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.searchParams.set('month', month);
    window.history.replaceState({}, '', url);
  }, [month]);

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  const resetForm = () => {
    setDraft({ employeeId: '', type: '', startDate: '', endDate: '', note: '' });
    setFormError(null);
    setFormOpen(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyId || !draft.employeeId || !draft.type || !draft.startDate || !draft.endDate) {
      setFormError(t('common.required'));
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      await api.post(`/api/companies/${companyId}/absences`, {
        employeeId: draft.employeeId,
        type: draft.type,
        startDate: new Date(draft.startDate).toISOString(),
        endDate: new Date(draft.endDate).toISOString(),
        note: draft.note || undefined,
      });
      await mutate();
      resetForm();
    } catch (err) {
      setFormError((err as Error)?.message ?? t('absences.createError'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!companyId) return;
    if (!window.confirm(t('absences.confirmDelete'))) return;
    setDeletingId(id);
    try {
      await api.delete(`/api/companies/${companyId}/absences/${id}`);
      await mutate();
    } catch (err) {
      alert((err as Error)?.message ?? t('absences.deleteError'));
    } finally {
      setDeletingId(null);
    }
  };

  const handleDecide = async (id: string, decision: 'approve' | 'reject') => {
    if (!companyId) return;
    setDecidingId(id);
    try {
      await api.patch(`/api/companies/${companyId}/absences/${id}/${decision}`, {});
      await mutate();
    } catch (err) {
      alert((err as Error)?.message ?? t('absences.decideError'));
    } finally {
      setDecidingId(null);
    }
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const hasError = companyErr || absencesErr;
  const rows = absences ?? [];
  const pendingRows = rows.filter((r) => r.status === 'PENDING');

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[10px] uppercase tracking-[0.28em] text-[#6b6966] mb-1">
            {t('absences.eyebrow')}
          </div>
          <h1
            className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl tracking-tight text-[#3d3b38]"
            style={{ fontFamily: 'Fraunces, serif', fontWeight: 400 }}
          >
            {t('absences.title')}
          </h1>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <MonthPicker value={month} onChange={setMonth} />
          <button
            onClick={() => setFormOpen((v) => !v)}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-full border border-[#E98074]/60 text-[#E98074] text-xs uppercase tracking-[0.22em] hover:bg-[#E98074]/10 transition-colors"
          >
            <span aria-hidden className="text-base leading-none">＋</span>
            {t('absences.addButton')}
          </button>
        </div>
      </div>

      {/* Inline add form */}
      {formOpen && (
        <div className="border border-[#8E8D8A]/20 rounded-2xl bg-[#EAE7DC] p-6">
          <div className="text-[10px] uppercase tracking-[0.28em] text-[#6b6966] mb-4">
            {t('absences.formTitle')}
          </div>
          <form onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Employee */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase tracking-[0.22em] text-[#6b6966]">
                  {t('absences.fieldEmployee')}
                </label>
                <select
                  value={draft.employeeId}
                  onChange={(e) => setDraft((d) => ({ ...d, employeeId: e.target.value }))}
                  required
                  className="h-9 px-3 rounded-lg border border-[#8E8D8A]/30 bg-transparent text-sm text-[#3d3b38] focus:outline-none focus:border-[#E98074]/60"
                >
                  <option value="">{t('absences.selectEmployee')}</option>
                  {employees.length === 0 && (
                    <option disabled>{t('absences.noEmployees')}</option>
                  )}
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name}{emp.position ? ` — ${emp.position}` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Type */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase tracking-[0.22em] text-[#6b6966]">
                  {t('absences.fieldType')}
                </label>
                <select
                  value={draft.type}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, type: e.target.value as AbsenceType | '' }))
                  }
                  required
                  className="h-9 px-3 rounded-lg border border-[#8E8D8A]/30 bg-transparent text-sm text-[#3d3b38] focus:outline-none focus:border-[#E98074]/60"
                >
                  <option value="">{t('absences.selectType')}</option>
                  {(Object.keys(typeLabels) as AbsenceType[]).map((k) => (
                    <option key={k} value={k}>
                      {typeLabels[k]}
                    </option>
                  ))}
                </select>
              </div>

              {/* Start date */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase tracking-[0.22em] text-[#6b6966]">
                  {t('absences.fieldStartDate')}
                </label>
                <input
                  type="date"
                  value={draft.startDate}
                  onChange={(e) => setDraft((d) => ({ ...d, startDate: e.target.value }))}
                  required
                  className="h-9 px-3 rounded-lg border border-[#8E8D8A]/30 bg-transparent text-sm text-[#3d3b38] focus:outline-none focus:border-[#E98074]/60"
                />
              </div>

              {/* End date */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase tracking-[0.22em] text-[#6b6966]">
                  {t('absences.fieldEndDate')}
                </label>
                <input
                  type="date"
                  value={draft.endDate}
                  onChange={(e) => setDraft((d) => ({ ...d, endDate: e.target.value }))}
                  required
                  min={draft.startDate || undefined}
                  className="h-9 px-3 rounded-lg border border-[#8E8D8A]/30 bg-transparent text-sm text-[#3d3b38] focus:outline-none focus:border-[#E98074]/60"
                />
              </div>

              {/* Note — full width */}
              <div className="flex flex-col gap-1 sm:col-span-2">
                <label className="text-[10px] uppercase tracking-[0.22em] text-[#6b6966]">
                  {t('absences.fieldNote')}
                  <span className="ml-1 normal-case tracking-normal text-[#6b6966]/60">
                    ({t('common.optional')})
                  </span>
                </label>
                <input
                  type="text"
                  value={draft.note}
                  onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
                  placeholder={t('absences.notePlaceholder')}
                  className="h-9 px-3 rounded-lg border border-[#8E8D8A]/30 bg-transparent text-sm text-[#3d3b38] placeholder-[#6b6966]/50 focus:outline-none focus:border-[#E98074]/60"
                />
              </div>
            </div>

            {formError && (
              <p className="mt-3 text-xs text-[#E85A4F]">{formError}</p>
            )}

            <div className="mt-5 flex items-center gap-3">
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-2 h-9 px-5 rounded-full bg-[#E98074] text-[#EAE7DC] text-xs uppercase tracking-[0.22em] hover:bg-[#d47068] transition-colors disabled:opacity-50"
              >
                {submitting ? '…' : t('common.save')}
              </button>
              <button
                type="button"
                onClick={resetForm}
                disabled={submitting}
                className="h-9 px-4 text-xs uppercase tracking-[0.22em] text-[#6b6966] hover:text-[#3d3b38] transition-colors disabled:opacity-50"
              >
                {t('common.cancel')}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Pending requests awaiting a decision */}
      {pendingRows.length > 0 && (
        <div className="border border-[#E98074]/40 rounded-2xl bg-[#E98074]/[0.06] overflow-hidden">
          <div className="px-6 py-3 border-b border-[#E98074]/25 text-[10px] uppercase tracking-[0.28em] text-[#6b6966]">
            {t('absences.pendingTitle')} ({pendingRows.length})
          </div>
          <ul>
            {pendingRows.map((row) => {
              const isDeciding = decidingId === row.id;
              return (
                <li
                  key={row.id}
                  className={cn(
                    'flex items-center gap-4 px-6 py-4 border-b border-[#E98074]/10 last:border-0 flex-wrap transition-colors',
                    isDeciding && 'opacity-40',
                  )}
                >
                  <div className="text-sm text-[#3d3b38] font-medium min-w-[8rem]">
                    {row.employeeName}
                  </div>
                  <TypeBadge type={row.type} label={typeLabels[row.type] ?? row.type} />
                  <div className="text-sm text-[#3d3b38]">
                    {formatDate(row.startDate)}
                    {row.startDate !== row.endDate && (
                      <span className="text-[#6b6966]"> — {formatDate(row.endDate)}</span>
                    )}
                  </div>
                  {row.note && (
                    <div className="text-sm text-[#6b6966] truncate max-w-[12rem]">{row.note}</div>
                  )}
                  <div className="ml-auto flex items-center gap-2">
                    <button
                      onClick={() => handleDecide(row.id, 'approve')}
                      disabled={isDeciding}
                      className="inline-flex items-center h-8 px-4 rounded-full bg-[#E98074] text-[#EAE7DC] text-xs uppercase tracking-[0.22em] hover:bg-[#d47068] transition-colors disabled:opacity-50"
                    >
                      {t('absences.approve')}
                    </button>
                    <button
                      onClick={() => handleDecide(row.id, 'reject')}
                      disabled={isDeciding}
                      className="inline-flex items-center h-8 px-4 rounded-full border border-[#E85A4F]/60 text-[#E85A4F] text-xs uppercase tracking-[0.22em] hover:bg-[#E85A4F]/10 transition-colors disabled:opacity-50"
                    >
                      {t('absences.reject')}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Content area */}
      {hasError ? (
        <div className="py-12 text-center">
          <p className="text-sm text-[#E85A4F]">{t('absences.loadError')}</p>
          <button
            onClick={() => { void mutate(); }}
            className="mt-3 text-xs uppercase tracking-[0.22em] text-[#6b6966] hover:text-[#E98074] transition-colors"
          >
            {t('common.retry')}
          </button>
        </div>
      ) : isLoading ? (
        <div className="border border-[#8E8D8A]/20 rounded-2xl overflow-hidden">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-6 py-4 border-b border-[#8E8D8A]/10">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-40" />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="border border-[#8E8D8A]/20 rounded-2xl py-16 text-center">
          <div
            className="text-3xl text-[#6b6966]"
            style={{ fontFamily: 'Fraunces, serif' }}
          >
            {t('absences.emptyTitle')}
          </div>
          <div className="mt-1 text-[11px] uppercase tracking-[0.22em] text-[#6b6966]">
            {t('absences.emptyHint')}
          </div>
        </div>
      ) : (
        <div className="border border-[#8E8D8A]/20 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
          <div className="min-w-[600px]">
          {/* Table header */}
          <div className="grid items-center gap-4 px-6 py-3 border-b border-[#8E8D8A]/25 bg-[#D8C3A5]/20 text-[10px] uppercase tracking-[0.28em] text-[#6b6966]"
            style={{ gridTemplateColumns: '2fr 1fr 1fr 1.5fr 1.5fr 40px' }}
          >
            <div>{t('absences.colEmployee')}</div>
            <div>{t('absences.colType')}</div>
            <div>{t('absences.colStatus')}</div>
            <div>{t('absences.colDates')}</div>
            <div>{t('absences.colNote')}</div>
            <div />
          </div>

          {/* Table rows */}
          <ul>
            {rows.map((row) => {
              const isDeleting = deletingId === row.id;
              return (
                <li
                  key={row.id}
                  className={cn(
                    'grid items-center gap-4 px-6 py-4 border-b border-[#8E8D8A]/10 last:border-0 transition-colors',
                    isDeleting ? 'opacity-40' : 'hover:bg-[#D8C3A5]/10',
                  )}
                  style={{ gridTemplateColumns: '2fr 1fr 1fr 1.5fr 1.5fr 40px' }}
                >
                  {/* Employee name */}
                  <div className="text-sm text-[#3d3b38] truncate font-medium">
                    {row.employeeName}
                  </div>

                  {/* Type badge */}
                  <div>
                    <TypeBadge
                      type={row.type}
                      label={typeLabels[row.type] ?? row.type}
                    />
                  </div>

                  {/* Status badge */}
                  <div>
                    <StatusBadge
                      status={row.status}
                      label={statusLabels[row.status] ?? row.status}
                    />
                  </div>

                  {/* Date range */}
                  <div className="text-sm text-[#3d3b38]">
                    {formatDate(row.startDate)}
                    {row.startDate !== row.endDate && (
                      <span className="text-[#6b6966]"> — {formatDate(row.endDate)}</span>
                    )}
                  </div>

                  {/* Note */}
                  <div className="text-sm text-[#6b6966] truncate">
                    {row.note ?? '—'}
                  </div>

                  {/* Delete button */}
                  <div className="flex justify-end">
                    <button
                      onClick={() => handleDelete(row.id)}
                      disabled={isDeleting}
                      aria-label={t('common.delete')}
                      className="text-[#8E8D8A]/50 hover:text-[#E85A4F] transition-colors disabled:opacity-30"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 14 14"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="1,3.5 13,3.5" />
                        <path d="M5 3.5V2.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 .5.5v1" />
                        <path d="M3 3.5l.7 8.5a.5.5 0 0 0 .5.5h5.6a.5.5 0 0 0 .5-.5l.7-8.5" />
                      </svg>
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          </div>
          </div>
        </div>
      )}
    </div>
  );
}
