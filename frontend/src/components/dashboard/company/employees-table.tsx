'use client';

import * as React from 'react';
import { Badge, cn } from '@tact/ui';
import { useLang } from '@/i18n/context';

export type Employee = {
  id: string;
  name: string;
  position?: string | null;
  role: 'OWNER' | 'MANAGER' | 'STAFF';
  status: 'ACTIVE' | 'INACTIVE';
  monthlySalary?: number | null;
  hourlyRate?: number | null;
  checkedInToday?: boolean;
  /** Last check-in type for the employee: 'IN' = currently in office, 'OUT' = left */
  lastCheckInType?: 'IN' | 'OUT' | null;
  lateCountMonth?: number;
  avatarUrl?: string | null;
  departmentId?: string | null;
  shiftId?: string | null;
  shift?: { id: string; name: string; startHour: number; endHour: number } | null;
  /** Per-employee work-hours override (null = inherit from shift / company). */
  workStartHour?: number | null;
  workEndHour?: number | null;
};

export interface EmployeesTableProps {
  rows: Employee[];
  onMenu?: (e: Employee, action: 'edit' | 'suspend' | 'remove') => void;
  /** Fired when a row (not the actions menu) is clicked — used to open the profile. */
  onSelect?: (e: Employee) => void;
  acting?: string | null;
  className?: string;
  /** When provided, a leading checkbox column is rendered for bulk selection. */
  selectedIds?: Set<string>;
  onToggleRow?: (id: string) => void;
  onToggleAll?: (checked: boolean) => void;
}

const GRID_COLS = 'grid grid-cols-[1.6fr_1.2fr_1fr_0.9fr_0.8fr_0.7fr_0.9fr_0.4fr]';
const GRID_COLS_SEL =
  'grid grid-cols-[0.3fr_1.6fr_1.2fr_1fr_0.9fr_0.8fr_0.7fr_0.9fr_0.4fr]';

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '');
}

function formatCurrency(v?: number | null, perHour = false) {
  if (v == null) return '—';
  const nf = new Intl.NumberFormat('ru-RU');
  return `${nf.format(v)}${perHour ? ' / ч' : ' ₸'}`;
}

function StatusBadge({ status }: { status: Employee['status'] }) {
  const { t } = useLang();
  if (status === 'ACTIVE') return <Badge variant="coral">{t('employees.statusActive')}</Badge>;
  return <Badge variant="red">{t('employees.statusInactive')}</Badge>;
}

function PresenceBadge({ type }: { type: Employee['lastCheckInType'] }) {
  const { t } = useLang();
  if (type === 'IN') {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: '#4CAF50' }}
          aria-hidden="true"
        />
        <span className="text-[11px] uppercase tracking-[0.2em] text-[#3d3b38]">
          {t('employees.presenceIn')}
        </span>
      </span>
    );
  }
  if (type === 'OUT') {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span
          className="w-2 h-2 rounded-full bg-[#8E8D8A] shrink-0"
          aria-hidden="true"
        />
        <span className="text-[11px] uppercase tracking-[0.2em] text-[#6b6966]">
          {t('employees.presenceOut')}
        </span>
      </span>
    );
  }
  // Unknown / no data
  return (
    <span className="text-[11px] uppercase tracking-[0.2em] text-[#8E8D8A]/60">
      {t('employees.presenceUnknown')}
    </span>
  );
}

function RowMenu({ row, onMenu, disabled }: { row: Employee; onMenu?: EmployeesTableProps['onMenu']; disabled?: boolean }) {
  const { t } = useLang();
  const [open, setOpen] = React.useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        className="h-8 w-8 rounded-full border border-transparent hover:border-[#8E8D8A]/30 hover:text-[#E98074] text-[#3d3b38] focus:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2 focus-visible:ring-offset-cream transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        onClick={() => setOpen((v) => !v)}
        aria-label={t('employees.actionsLabel', { name: row.name })}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span aria-hidden="true">…</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-9 z-10 w-44 border border-[#8E8D8A]/20 bg-[#EAE7DC] shadow-xl rounded-lg py-1 text-sm"
        >
          <button
            role="menuitem"
            className="w-full text-left px-3 py-2 text-[#3d3b38] hover:text-[#E98074] focus:outline-none focus-visible:bg-[#D8C3A5]/40"
            onClick={() => {
              setOpen(false);
              onMenu?.(row, 'edit');
            }}
          >
            {t('employees.menuEdit')}
          </button>
          <button
            role="menuitem"
            className="w-full text-left px-3 py-2 text-[#3d3b38] hover:text-[#E98074] focus:outline-none focus-visible:bg-[#D8C3A5]/40"
            onClick={() => {
              setOpen(false);
              onMenu?.(row, 'suspend');
            }}
          >
            {row.status === 'INACTIVE' ? t('employees.menuReactivate') : t('employees.menuSuspend')}
          </button>
          <button
            role="menuitem"
            className="w-full text-left px-3 py-2 text-[#E85A4F] focus:outline-none focus-visible:bg-[#D8C3A5]/40"
            onClick={() => {
              setOpen(false);
              onMenu?.(row, 'remove');
            }}
          >
            {t('employees.menuRemove')}
          </button>
        </div>
      )}
    </div>
  );
}

export function EmployeesTable({
  rows,
  onMenu,
  onSelect,
  acting,
  className,
  selectedIds,
  onToggleRow,
  onToggleAll,
}: EmployeesTableProps) {
  const { t } = useLang();
  const selectable = !!selectedIds && !!onToggleRow;
  const gridCols = selectable ? GRID_COLS_SEL : GRID_COLS;
  const allSelected = selectable && rows.length > 0 && rows.every((r) => selectedIds!.has(r.id));

  if (rows.length === 0) {
    return (
      <div className={cn('py-16 text-center', className)} role="region" aria-label={t('employees.eyebrow')}>
        <div className="text-4xl text-[#6b6966]" style={{ fontFamily: 'Fraunces, serif' }}>
          {t('employees.emptyTitle')}
        </div>
        <div className="mt-2 text-xs uppercase tracking-[0.24em] text-[#6b6966]">
          {t('employees.emptyHint')}
        </div>
      </div>
    );
  }

  return (
    <div role="region" aria-label={t('employees.eyebrow')} className={cn('w-full', className)}>
      <table className="w-full border-collapse" aria-label={t('employees.eyebrow')}>
        <thead>
          <tr
            className={cn(
              gridCols,
              'px-4 py-3 border-b border-[#8E8D8A]/25 text-[10px] uppercase tracking-[0.28em] text-[#6b6966]',
            )}
          >
            {selectable && (
              <th scope="col" className="flex items-center font-normal">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[#E98074]"
                  checked={allSelected}
                  onChange={(e) => onToggleAll?.(e.target.checked)}
                  aria-label={t('employees.colName')}
                />
              </th>
            )}
            <th scope="col" className="text-left font-normal">
              {t('employees.colName')}
            </th>
            <th scope="col" className="text-left font-normal">
              {t('employees.colPosition')}
            </th>
            <th scope="col" className="text-left font-normal">
              {t('employees.colRate')}
            </th>
            <th scope="col" className="text-left font-normal">
              {t('employees.colStatus')}
            </th>
            <th scope="col" className="text-left font-normal">
              {t('employees.colPresence')}
            </th>
            <th scope="col" className="text-center font-normal">
              {t('employees.colToday')}
            </th>
            <th scope="col" className="text-right font-normal">
              {t('employees.colLateMonth')}
            </th>
            <th scope="col" aria-label={t('employees.colActions')} className="font-normal" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              onClick={onSelect ? () => onSelect(r) : undefined}
              className={cn(
                gridCols,
                'items-center px-4 py-4 border-b border-[#8E8D8A]/10 hover:bg-[#D8C3A5]/15 transition-colors',
                onSelect && 'cursor-pointer',
              )}
            >
              {selectable && (
                <td className="flex items-center" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[#E98074]"
                    checked={selectedIds!.has(r.id)}
                    onChange={() => onToggleRow!(r.id)}
                    aria-label={r.name}
                  />
                </td>
              )}
              <th scope="row" className="flex items-center gap-3 min-w-0 font-normal text-left">
                <span
                  className="w-9 h-9 rounded-full bg-[#D8C3A5] text-[#3d3b38] flex items-center justify-center text-xs uppercase tracking-[0.22em] shrink-0"
                  aria-hidden={r.avatarUrl ? undefined : 'true'}
                >
                  {r.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={r.avatarUrl}
                      alt=""
                      className="w-full h-full object-cover rounded-full"
                    />
                  ) : (
                    initials(r.name)
                  )}
                </span>
                <span className="min-w-0">
                  <span
                    className="block text-base tracking-tight text-[#2a2927] truncate"
                    style={{ fontFamily: 'Fraunces, serif' }}
                  >
                    {r.name}
                  </span>
                  <span className="block text-[10px] uppercase tracking-[0.22em] text-[#6b6966]">
                    {r.role.toLowerCase()}
                  </span>
                  {r.shift && (
                    <span className="mt-0.5 inline-flex items-center rounded-full bg-[#E98074]/15 px-2 py-0.5 text-[9px] uppercase tracking-[0.2em] text-[#E98074]">
                      {r.shift.name}
                    </span>
                  )}
                </span>
              </th>
              <td className="text-sm text-[#3d3b38] truncate">{r.position || '—'}</td>
              <td className="text-sm tabular-nums text-[#3d3b38]">
                {r.monthlySalary
                  ? formatCurrency(r.monthlySalary)
                  : formatCurrency(r.hourlyRate, true)}
              </td>
              <td>
                <StatusBadge status={r.status} />
              </td>
              <td>
                <PresenceBadge type={r.lastCheckInType} />
              </td>
              <td className="text-center">
                {r.checkedInToday ? (
                  <>
                    <span className="text-[#E98074] text-lg leading-none" aria-hidden="true">
                      ✓
                    </span>
                    <span className="sr-only">{t('employees.checkedInToday')}</span>
                  </>
                ) : (
                  <>
                    <span className="text-[#E85A4F] text-lg leading-none" aria-hidden="true">
                      ×
                    </span>
                    <span className="sr-only">{t('employees.notCheckedInToday')}</span>
                  </>
                )}
              </td>
              <td className="text-right tabular-nums" style={{ fontFamily: 'Fraunces, serif' }}>
                {r.lateCountMonth != null ? (
                  <span
                    className={cn(
                      'text-xl',
                      (r.lateCountMonth ?? 0) > 0 ? 'text-[#E85A4F]' : 'text-[#6b6966]',
                    )}
                  >
                    {r.lateCountMonth}
                  </span>
                ) : (
                  <span className="text-[#6b6966]">—</span>
                )}
              </td>
              <td className="flex justify-end" onClick={(e) => e.stopPropagation()}>
                <RowMenu row={r} onMenu={onMenu} disabled={acting === r.id} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default EmployeesTable;
