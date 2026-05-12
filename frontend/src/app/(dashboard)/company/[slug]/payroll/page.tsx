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

type PayrollBasis = 'salary' | 'hourly' | 'none';

type PayrollRow = {
  id: string;
  name: string;
  position: string | null;
  basis: PayrollBasis;
  monthlySalary: number | null;
  hourlyRate: number | null;
  expectedHours: number;
  workedHours: number;
  deltaHours: number;
  estimatedPay: number | null;
  proratedPay: number | null;
  penaltyDays: number;
  penaltyTotal: number;
  netPay: number;
};

type PayrollReport = {
  year: number;
  month: number;
  workingDays: number;
  employees: PayrollRow[];
  totals?: { penaltyTotal: number };
};

function currentYearMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const nf = new Intl.NumberFormat('ru-RU');
const nf1 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });

function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-[#D8C3A5]/40', className)} />;
}

export default function PayrollPage() {
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

  const reportKey = companyId ? `/api/companies/${companyId}/payroll?month=${month}` : null;
  const { data, error, isLoading, mutate } = useSWR<PayrollReport>(reportKey, fetcher);

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
      const res = await api.post<ExportResp>('/api/sheets/payroll', { companyId, month });
      const url = res.spreadsheetUrl ?? res.url ?? null;
      if (!url) throw new Error(t('payroll.exportError'));
      setExportUrl(url);
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 501) {
        setExportErr(t('reports.exportNotConfigured'));
      } else {
        const msg = err instanceof Error ? err.message : t('payroll.exportError');
        if (/Google|подключить|connect/i.test(msg)) {
          setExportNeedsGoogle(true);
        }
        setExportErr(msg);
      }
    } finally {
      setExporting(false);
    }
  };

  const rows = data?.employees ?? [];
  const totalEstimated = rows.reduce((s, r) => s + (r.estimatedPay ?? 0), 0);
  const totalExpected = rows.reduce((s, r) => s + r.expectedHours, 0);
  const totalWorked = rows.reduce((s, r) => s + r.workedHours, 0);
  const totalPenalty = data?.totals?.penaltyTotal ?? rows.reduce((s, r) => s + (r.penaltyTotal ?? 0), 0);
  const totalNet = rows.reduce((s, r) => s + (r.netPay ?? r.estimatedPay ?? 0), 0);

  function rateLabel(r: PayrollRow): string {
    if (r.basis === 'hourly' && r.hourlyRate != null) {
      return `${nf2.format(r.hourlyRate)} / ${t('payroll.perHour')}`;
    }
    if (r.basis === 'salary' && r.monthlySalary != null) {
      return `${nf.format(r.monthlySalary)} / ${t('payroll.perMonth')}`;
    }
    return '—';
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[10px] uppercase tracking-[0.28em] text-[#6b6966]">
            {t('payroll.eyebrow')}
          </div>
          <h1
            className="mt-2 text-3xl sm:text-4xl md:text-5xl lg:text-6xl tracking-tight text-[#3d3b38]"
            style={{ fontFamily: 'Fraunces, serif', fontWeight: 400 }}
          >
            {t('payroll.title')}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <MonthPicker value={month} onChange={setMonth} />
          <Button variant="primary" onClick={runExport} disabled={exporting || !companyId}>
            {exporting ? t('payroll.exportSheetsLoading') : t('payroll.exportSheets')}
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
              <span className="text-sm text-[#3d3b38]">{t('payroll.exportSheetsDone')}</span>
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

      <p className="text-sm text-[#6b6966] max-w-2xl leading-relaxed">
        {t('payroll.note')}
        {data ? ` ${t('payroll.workingDays')}: ${data.workingDays}.` : ''}
      </p>

      <Card className="!p-0 overflow-hidden overflow-x-auto">
        {error ? (
          <div className="py-10 text-center">
            <p className="text-sm text-[#E85A4F] tracking-tight">{t('payroll.loadError')}</p>
            <Button variant="ghost" size="sm" className="mt-3" onClick={() => mutate()}>
              {t('common.retry')}
            </Button>
          </div>
        ) : isLoading || !data ? (
          <div className="p-6 flex flex-col gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="py-14 text-center">
            <div className="text-3xl text-[#6b6966]" style={{ fontFamily: 'Fraunces, serif' }}>
              {t('common.empty')}
            </div>
            <div className="mt-1 text-[11px] uppercase tracking-[0.22em] text-[#6b6966]">
              {t('payroll.empty')}
            </div>
          </div>
        ) : (
          <table className="w-full min-w-[1080px] border-collapse">
            <thead>
              <tr className="border-b border-[#8E8D8A]/25 text-[10px] uppercase tracking-[0.28em] text-[#6b6966]">
                <th className="text-left font-normal px-4 py-3">{t('payroll.colEmployee')}</th>
                <th className="text-left font-normal px-4 py-3">{t('payroll.colPosition')}</th>
                <th className="text-left font-normal px-4 py-3">{t('payroll.colRate')}</th>
                <th className="text-right font-normal px-4 py-3">{t('payroll.colExpectedHours')}</th>
                <th className="text-right font-normal px-4 py-3">{t('payroll.colWorkedHours')}</th>
                <th className="text-right font-normal px-4 py-3">{t('payroll.colDelta')}</th>
                <th className="text-right font-normal px-4 py-3">{t('payroll.colEstimatedPay')}</th>
                <th className="text-right font-normal px-4 py-3">{t('payroll.penaltyDays')}</th>
                <th className="text-right font-normal px-4 py-3">{t('payroll.penaltyTotal')}</th>
                <th className="text-right font-normal px-4 py-3">{t('payroll.netPay')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-[#8E8D8A]/10 hover:bg-[#D8C3A5]/15 transition-colors"
                >
                  <td className="px-4 py-3.5">
                    <span className="text-base tracking-tight" style={{ fontFamily: 'Fraunces, serif' }}>
                      {r.name}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-sm text-[#6b6966]">{r.position ?? '—'}</td>
                  <td className="px-4 py-3.5 text-sm text-[#3d3b38] tabular-nums">{rateLabel(r)}</td>
                  <td className="px-4 py-3.5 text-right text-sm text-[#3d3b38] tabular-nums">
                    {nf1.format(r.expectedHours)}
                  </td>
                  <td className="px-4 py-3.5 text-right text-sm text-[#3d3b38] tabular-nums">
                    {nf1.format(r.workedHours)}
                  </td>
                  <td
                    className={cn(
                      'px-4 py-3.5 text-right text-sm tabular-nums',
                      r.deltaHours < 0 ? 'text-[#E85A4F]' : 'text-[#3d3b38]',
                    )}
                  >
                    {r.deltaHours > 0 ? '+' : ''}
                    {nf1.format(r.deltaHours)}
                  </td>
                  <td className="px-4 py-3.5 text-right tabular-nums">
                    {r.estimatedPay != null ? (
                      <span className="text-lg" style={{ fontFamily: 'Fraunces, serif' }}>
                        ≈ {nf.format(r.estimatedPay)}
                      </span>
                    ) : (
                      <span className="text-sm text-[#6b6966]">{t('payroll.noBasis')}</span>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-right text-sm text-[#3d3b38] tabular-nums">
                    {r.penaltyDays > 0 ? r.penaltyDays : '—'}
                  </td>
                  <td className="px-4 py-3.5 text-right text-sm tabular-nums text-[#E85A4F]">
                    {r.penaltyTotal > 0 ? `− ${nf.format(r.penaltyTotal)}` : '—'}
                  </td>
                  <td className="px-4 py-3.5 text-right tabular-nums">
                    <span className="text-lg" style={{ fontFamily: 'Fraunces, serif' }}>
                      {nf.format(r.netPay ?? r.estimatedPay ?? 0)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-[#8E8D8A]/30 bg-[#D8C3A5]/15">
                <td className="px-4 py-3.5 text-[11px] uppercase tracking-[0.22em] text-[#6b6966]" colSpan={3}>
                  {t('payroll.totals')}
                </td>
                <td className="px-4 py-3.5 text-right text-sm text-[#3d3b38] tabular-nums">
                  {nf1.format(totalExpected)}
                </td>
                <td className="px-4 py-3.5 text-right text-sm text-[#3d3b38] tabular-nums">
                  {nf1.format(totalWorked)}
                </td>
                <td className="px-4 py-3.5" />
                <td className="px-4 py-3.5 text-right tabular-nums">
                  <span className="text-xl" style={{ fontFamily: 'Fraunces, serif' }}>
                    ≈ {nf.format(totalEstimated)}
                  </span>
                </td>
                <td className="px-4 py-3.5" />
                <td className="px-4 py-3.5 text-right text-sm tabular-nums text-[#E85A4F]">
                  {totalPenalty > 0 ? `− ${nf.format(totalPenalty)}` : '—'}
                </td>
                <td className="px-4 py-3.5 text-right tabular-nums">
                  <span className="text-xl" style={{ fontFamily: 'Fraunces, serif' }}>
                    {nf.format(totalNet)}
                  </span>
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </Card>
    </div>
  );
}
