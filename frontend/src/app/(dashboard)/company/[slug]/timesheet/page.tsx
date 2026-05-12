'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import useSWR from 'swr';
import { Button, Card, cn } from '@tact/ui';
import { fetcher } from '@/lib/fetcher';
import { api, ApiError } from '@/lib/api';
import { MonthPicker } from '@/components/dashboard/company/month-picker';
import { useLang } from '@/i18n/context';

type ExportResp = { spreadsheetUrl?: string; url?: string };

type CompanyDetail = { id: string; slug: string; name: string };

type CellState =
  | 'present'
  | 'late'
  | 'vacation'
  | 'sick'
  | 'dayoff'
  | 'trip'
  | 'holiday'
  | 'weekend'
  | 'absent';

type TimesheetEmployee = {
  id: string;
  name: string;
  position: string | null;
  cells: Record<string, CellState>;
};

type Timesheet = {
  year: number;
  month: number;
  days: number;
  employees: TimesheetEmployee[];
};

function currentYearMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Visual treatment per cell state. `glyph` is rendered centred in the day
// column; `cellClass` tints the cell background.
const STATE_STYLE: Record<
  CellState,
  { glyph: React.ReactNode; cellClass: string; glyphClass: string }
> = {
  present: { glyph: '·', cellClass: '', glyphClass: 'text-[#6b6966]' },
  late: {
    glyph: <span className="inline-block h-2 w-2 rounded-full bg-[#E85A4F]" />,
    cellClass: '',
    glyphClass: '',
  },
  vacation: { glyph: '🏖', cellClass: 'bg-[#D8C3A5]/30', glyphClass: '' },
  sick: { glyph: '🤒', cellClass: 'bg-[#D8C3A5]/30', glyphClass: '' },
  dayoff: { glyph: 'В', cellClass: 'bg-[#D8C3A5]/25', glyphClass: 'text-xs text-[#6b6966]' },
  trip: { glyph: '✈', cellClass: 'bg-[#D8C3A5]/25', glyphClass: 'text-[#6b6966]' },
  holiday: {
    glyph: 'П',
    cellClass: 'bg-[#E98074]/12',
    glyphClass: 'text-xs text-[#E98074]',
  },
  weekend: { glyph: '', cellClass: 'bg-[#8E8D8A]/10', glyphClass: '' },
  absent: { glyph: '', cellClass: 'bg-[#E85A4F]/12', glyphClass: '' },
};

function isWeekendDay(year: number, month: number, day: number): boolean {
  const wd = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return wd === 0 || wd === 6;
}

function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-[#D8C3A5]/40', className)} />;
}

export default function TimesheetPage() {
  const { t } = useLang();
  const params = useParams<{ slug: string }>();
  const slug = params?.slug;

  const [month, setMonth] = React.useState<string>(() => {
    if (typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search);
      return sp.get('month') || currentYearMonth();
    }
    return currentYearMonth();
  });

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.searchParams.set('month', month);
    window.history.replaceState({}, '', url);
  }, [month]);

  const { data: company } = useSWR<CompanyDetail>(slug ? `/api/companies/${slug}` : null, fetcher);
  const companyId = company?.id;

  const key = companyId ? `/api/companies/${companyId}/timesheet?month=${month}` : null;
  const { data, error, isLoading, mutate } = useSWR<Timesheet>(key, fetcher);

  const [exporting, setExporting] = React.useState(false);
  const [exportUrl, setExportUrl] = React.useState<string | null>(null);
  const [exportErr, setExportErr] = React.useState<string | null>(null);
  const [exportNeedsGoogle, setExportNeedsGoogle] = React.useState(false);

  const runExport = async () => {
    if (!companyId) return;
    setExporting(true);
    setExportErr(null);
    setExportUrl(null);
    setExportNeedsGoogle(false);
    try {
      const res = await api.post<ExportResp>('/api/sheets/timesheet', { companyId, month });
      const url = res.spreadsheetUrl ?? res.url ?? null;
      if (!url) throw new Error(t('timesheet.exportError'));
      setExportUrl(url);
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 501) {
        setExportErr(t('reports.exportNotConfigured'));
      } else {
        const msg = err instanceof Error ? err.message : t('timesheet.exportError');
        if (/Google|подключить|connect/i.test(msg)) {
          setExportNeedsGoogle(true);
        }
        setExportErr(msg);
      }
    } finally {
      setExporting(false);
    }
  };

  const dayNumbers = data ? Array.from({ length: data.days }, (_, i) => i + 1) : [];

  const legend: { state: CellState; label: string }[] = [
    { state: 'present', label: t('timesheet.legendPresent') },
    { state: 'late', label: t('timesheet.legendLate') },
    { state: 'vacation', label: t('timesheet.legendVacation') },
    { state: 'sick', label: t('timesheet.legendSick') },
    { state: 'dayoff', label: t('timesheet.legendDayoff') },
    { state: 'trip', label: t('timesheet.legendTrip') },
    { state: 'holiday', label: t('timesheet.legendHoliday') },
    { state: 'weekend', label: t('timesheet.legendWeekend') },
    { state: 'absent', label: t('timesheet.legendAbsent') },
  ];

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[10px] uppercase tracking-[0.28em] text-[#6b6966]">
            {t('timesheet.eyebrow')}
          </div>
          <h1
            className="mt-2 text-3xl sm:text-4xl md:text-5xl lg:text-6xl tracking-tight text-[#3d3b38]"
            style={{ fontFamily: 'Fraunces, serif', fontWeight: 400 }}
          >
            {t('timesheet.title')}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <MonthPicker value={month} onChange={setMonth} />
          <Button variant="primary" onClick={runExport} disabled={exporting || !companyId}>
            {exporting ? t('timesheet.exportSheetsLoading') : t('timesheet.exportSheets')}
          </Button>
        </div>
      </div>

      {(exportUrl || exportErr) && (
        <Card
          className="!py-4 !px-5"
          eyebrow={exportUrl ? t('common.done') : t('common.error')}
        >
          {exportUrl ? (
            <div className="flex items-center justify-between gap-6 flex-wrap">
              <span className="text-sm text-[#3d3b38]">{t('timesheet.exportSheetsDone')}</span>
              <a
                href={exportUrl}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-[#E98074] hover:text-[#E85A4F] underline underline-offset-4"
              >
                {t('reports.exportOpen')}
              </a>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-6 flex-wrap">
              <span className="text-sm text-[#E85A4F]">{exportErr}</span>
              {exportNeedsGoogle && (
                <Link
                  href="/profile"
                  className="text-sm text-[#E98074] hover:text-[#E85A4F] underline underline-offset-4"
                >
                  {t('reports.exportConnectGoogle')}
                </Link>
              )}
            </div>
          )}
        </Card>
      )}

      <Card className="!p-0 overflow-hidden">
        {error ? (
          <div className="py-10 text-center">
            <p className="text-sm text-[#E85A4F] tracking-tight">{t('timesheet.loadError')}</p>
            <button
              onClick={() => mutate()}
              className="mt-3 text-xs uppercase tracking-[0.22em] text-[#E98074] hover:text-[#E85A4F]"
            >
              {t('common.retry')}
            </button>
          </div>
        ) : isLoading || !data ? (
          <div className="p-6 flex flex-col gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : data.employees.length === 0 ? (
          <div className="py-14 text-center">
            <div className="text-3xl text-[#6b6966]" style={{ fontFamily: 'Fraunces, serif' }}>
              {t('common.empty')}
            </div>
            <div className="mt-1 text-[11px] uppercase tracking-[0.22em] text-[#6b6966]">
              {t('timesheet.empty')}
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[900px]">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-[#8E8D8A]/25">
                    <th className="sticky left-0 z-10 bg-[#EAE7DC] px-4 py-3 text-left text-[10px] uppercase tracking-[0.28em] text-[#6b6966]">
                      {t('timesheet.colEmployee')}
                    </th>
                    {dayNumbers.map((d) => {
                      const we = isWeekendDay(data.year, data.month, d);
                      return (
                        <th
                          key={d}
                          className={cn(
                            'px-0 py-3 text-center text-[10px] tabular-nums w-7',
                            we ? 'text-[#8E8D8A]' : 'text-[#6b6966]',
                          )}
                        >
                          {d}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {data.employees.map((emp) => (
                    <tr
                      key={emp.id}
                      className="border-b border-[#8E8D8A]/10 hover:bg-[#D8C3A5]/10 transition-colors"
                    >
                      <td className="sticky left-0 z-10 bg-[#EAE7DC] px-4 py-2.5">
                        <div
                          className="text-sm tracking-tight text-[#3d3b38]"
                          style={{ fontFamily: 'Fraunces, serif' }}
                        >
                          {emp.name}
                        </div>
                        {emp.position && (
                          <div className="text-[10px] uppercase tracking-[0.22em] text-[#6b6966]">
                            {emp.position}
                          </div>
                        )}
                      </td>
                      {dayNumbers.map((d) => {
                        const state = emp.cells[String(d)] ?? 'absent';
                        const s = STATE_STYLE[state];
                        return (
                          <td
                            key={d}
                            className={cn(
                              'h-9 w-7 text-center align-middle border-l border-[#8E8D8A]/10',
                              s.cellClass,
                            )}
                            title={t(`timesheet.legend${state[0].toUpperCase()}${state.slice(1)}`)}
                          >
                            <span className={cn('text-sm leading-none', s.glyphClass)}>
                              {s.glyph}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {legend.map(({ state, label }) => {
          const s = STATE_STYLE[state];
          return (
            <div key={state} className="flex items-center gap-2">
              <span
                className={cn(
                  'inline-flex h-5 w-5 items-center justify-center rounded border border-[#8E8D8A]/25 text-xs',
                  s.cellClass,
                  s.glyphClass,
                )}
              >
                {s.glyph}
              </span>
              <span className="text-xs text-[#6b6966] tracking-tight">{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
