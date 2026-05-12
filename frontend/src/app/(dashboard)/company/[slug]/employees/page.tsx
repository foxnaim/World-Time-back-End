'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import useSWR from 'swr';
import { Button, Card, cn } from '@tact/ui';
import { fetcher } from '@/lib/fetcher';
import { api } from '@/lib/api';
import { useToast } from '@/components/ui/use-toast';
import { EmployeesTable, type Employee } from '@/components/dashboard/company/employees-table';
import { InviteModal } from '@/components/dashboard/company/invite-modal';
import { EditEmployeeModal } from '@/components/dashboard/company/edit-employee-modal';
import { Dropdown, DropdownItem } from '@/components/ui/dropdown';
import { useLang } from '@/i18n/context';

/** Pill-style filter dropdown with a real popup menu (replaces a bare <select>). */
function FilterSelect({
  value,
  onChange,
  options,
  allLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { id: string; name: string }[];
  allLabel: string;
}) {
  const current = options.find((o) => o.id === value);
  return (
    <Dropdown
      align="left"
      trigger={
        <span className="inline-flex items-center gap-2 h-10 rounded-full border border-[#8E8D8A]/25 bg-transparent px-4 text-sm text-[#3d3b38] hover:border-[#E98074]/50 transition-colors">
          {current?.name ?? allLabel}
          <span aria-hidden className="text-[10px] text-[#8E8D8A]">▾</span>
        </span>
      }
      menuClassName="max-h-64 overflow-y-auto"
    >
      <DropdownItem onClick={() => onChange('')}>{allLabel}</DropdownItem>
      {options.map((o) => (
        <DropdownItem key={o.id} onClick={() => onChange(o.id)}>
          {o.name}
        </DropdownItem>
      ))}
    </Dropdown>
  );
}

type CompanyDetail = {
  id: string;
  slug: string;
  name: string;
};

type EmployeesResp = { items: Employee[] };

type Department = {
  id: string;
  name: string;
  employeeCount: number;
};

type Shift = {
  id: string;
  name: string;
  startHour: number;
  endHour: number;
  employeeCount: number;
};

function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-[#D8C3A5]/40', className)} />;
}

function ErrorState({ onRetry, label }: { onRetry: () => void; label: string }) {
  const { t } = useLang();
  return (
    <div className="py-12 text-center">
      <p className="text-sm text-[#E85A4F] tracking-tight">
        {label}
      </p>
      <Button variant="ghost" size="sm" className="mt-3" onClick={onRetry}>
        {t('common.retry')}
      </Button>
    </div>
  );
}

/** Compact department dropdown shown inline in the employees table footer. */
function DepartmentAssignRow({
  employee,
  departments,
  companyId,
  onAssigned,
}: {
  employee: Employee;
  departments: Department[];
  companyId: string;
  onAssigned: () => void;
}) {
  const { t } = useLang();
  const toast = useToast();
  const [saving, setSaving] = React.useState(false);

  const handleChange = async (deptId: string) => {
    setSaving(true);
    try {
      await api.patch(`/api/companies/${companyId}/employees/${employee.id}`, {
        departmentId: deptId === '' ? null : deptId,
      });
      toast.success(t('departments.assignSaved'));
      onAssigned();
    } catch (err) {
      toast.error(t('departments.assignError'), {
        description: err instanceof Error ? err.message : '',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] uppercase tracking-[0.22em] text-[#6b6966] shrink-0">
        {t('departments.assignDepartment')}
      </span>
      <select
        value={employee.departmentId ?? ''}
        disabled={saving}
        onChange={(e) => void handleChange(e.target.value)}
        className="h-8 rounded-full border border-[#8E8D8A]/30 bg-transparent px-3 text-xs text-[#3d3b38] focus:outline-none focus:border-[#E98074]/60 disabled:opacity-50 transition-colors"
      >
        <option value="">{t('departments.noDepartment')}</option>
        {departments.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Wraps EmployeesTable with an extra department-assign row below each employee. */
function EmployeesWithDepartments({
  rows,
  departments,
  companyId,
  acting,
  onMenu,
  onAssigned,
  onSelect,
}: {
  rows: Employee[];
  departments: Department[];
  companyId: string;
  acting: string | null;
  onMenu: (e: Employee, action: 'edit' | 'suspend' | 'remove') => void;
  onAssigned: () => void;
  onSelect?: (e: Employee) => void;
}) {
  const { t } = useLang();

  // If no departments configured, just render the plain table.
  if (departments.length === 0) {
    return <EmployeesTable rows={rows} acting={acting} onMenu={onMenu} onSelect={onSelect} />;
  }

  if (rows.length === 0) {
    return (
      <div className="py-16 text-center">
        <div className="text-4xl text-[#6b6966]" style={{ fontFamily: 'Fraunces, serif' }}>
          {t('common.empty')}
        </div>
        <div className="mt-2 text-xs uppercase tracking-[0.24em] text-[#6b6966]">
          {t('employees.emptyHint')}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      {rows.map((employee, idx) => (
        <div
          key={employee.id}
          className={cn(
            'border-b border-[#8E8D8A]/10',
            idx === rows.length - 1 && 'border-b-0',
          )}
        >
          {/* Reuse the table for a single row by slicing — simpler: render inline */}
          <div
            className={cn(
              'px-4 py-4 flex items-center gap-3 hover:bg-[#D8C3A5]/15 transition-colors',
              onSelect && 'cursor-pointer',
            )}
            onClick={onSelect ? () => onSelect(employee) : undefined}
          >
            {/* Avatar */}
            <span
              className="w-9 h-9 rounded-full bg-[#D8C3A5] text-[#3d3b38] flex items-center justify-center text-xs uppercase tracking-[0.22em] shrink-0"
              aria-hidden={employee.avatarUrl ? undefined : 'true'}
            >
              {employee.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={employee.avatarUrl}
                  alt=""
                  className="w-full h-full object-cover rounded-full"
                />
              ) : (
                (employee.name.trim().split(/\s+/)[0]?.[0] ?? '') +
                (employee.name.trim().split(/\s+/)[1]?.[0] ?? '')
              )}
            </span>
            {/* Name + role */}
            <div className="flex-1 min-w-0">
              <div
                className="text-base tracking-tight text-[#2a2927] truncate"
                style={{ fontFamily: 'Fraunces, serif' }}
              >
                {employee.name}
              </div>
              <div className="text-[10px] uppercase tracking-[0.22em] text-[#6b6966]">
                {employee.role.toLowerCase()}
                {employee.position ? ` · ${employee.position}` : ''}
              </div>
            </div>
            {/* Department assign */}
            <div onClick={(e) => e.stopPropagation()}>
              <DepartmentAssignRow
                employee={employee}
                departments={departments}
                companyId={companyId}
                onAssigned={onAssigned}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function EmployeesPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug;
  const router = useRouter();
  const toast = useToast();
  const { t } = useLang();

  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [deptFilter, setDeptFilter] = React.useState('');
  const [shiftFilter, setShiftFilter] = React.useState('');
  const [absentTodayOnly, setAbsentTodayOnly] = React.useState(false);
  const [showInactive, setShowInactive] = React.useState(false);
  const [editing, setEditing] = React.useState<Employee | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState<Employee | null>(null);
  const [acting, setActing] = React.useState<string | null>(null);
  const [showDeptAssign, setShowDeptAssign] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(() => new Set());
  const [bulkRunning, setBulkRunning] = React.useState(false);
  const [confirmBulkDeactivate, setConfirmBulkDeactivate] = React.useState(false);

  const { data: company, error: companyErr } = useSWR<CompanyDetail>(
    slug ? `/api/companies/${slug}` : null,
    fetcher,
  );
  const id = company?.id;

  const { data, error, isLoading, mutate } = useSWR<EmployeesResp>(
    id
      ? `/api/companies/${id}/employees${showInactive ? '?includeInactive=1' : ''}`
      : null,
    fetcher,
  );

  const { data: departments = [] } = useSWR<Department[]>(
    id ? `/api/companies/${id}/departments` : null,
    fetcher,
  );

  const { data: shifts = [] } = useSWR<Shift[]>(
    id ? `/api/companies/${id}/shifts` : null,
    fetcher,
  );

  // Distinct shifts derived from the current roster payload (avoids an extra fetch).
  const shiftOptions = React.useMemo(() => {
    const seen = new Map<string, string>();
    for (const e of data?.items ?? []) {
      if (e.shift) seen.set(e.shift.id, e.shift.name);
    }
    return Array.from(seen, ([sid, name]) => ({ id: sid, name }));
  }, [data]);

  const rows = React.useMemo(() => {
    let items = data?.items ?? [];
    const q = query.trim().toLowerCase();
    if (q) {
      items = items.filter(
        (e) => e.name.toLowerCase().includes(q) || (e.position ?? '').toLowerCase().includes(q),
      );
    }
    if (deptFilter) items = items.filter((e) => e.departmentId === deptFilter);
    if (shiftFilter) items = items.filter((e) => e.shiftId === shiftFilter);
    if (absentTodayOnly) items = items.filter((e) => e.checkedInToday === false);
    return items;
  }, [data, query, deptFilter, shiftFilter, absentTodayOnly]);

  const goToProfile = React.useCallback(
    (employee: Employee) => {
      if (!slug) return;
      router.push(`/company/${slug}/employees/${employee.id}`);
    },
    [router, slug],
  );

  const handleMenu = React.useCallback(
    async (employee: Employee, action: 'edit' | 'suspend' | 'remove') => {
      if (action === 'edit') {
        setEditing(employee);
        return;
      }

      if (action === 'remove') {
        setConfirmDelete(employee);
        return;
      }

      // suspend / reactivate
      if (!id) return;
      setActing(employee.id);
      const newStatus = employee.status === 'INACTIVE' ? 'ACTIVE' : 'INACTIVE';
      try {
        await api.patch(`/api/companies/${id}/employees/${employee.id}`, { status: newStatus });
        toast.success(newStatus === 'INACTIVE' ? t('employees.suspended') : t('employees.reactivated'));
        await mutate();
      } catch (err) {
        toast.error(t('common.error'), { description: err instanceof Error ? err.message : t('employees.changeError') });
      } finally {
        setActing(null);
      }
    },
    [id, mutate, toast, t],
  );

  const handleDelete = React.useCallback(async () => {
    if (!confirmDelete || !id) return;
    setActing(confirmDelete.id);
    try {
      await api.delete(`/api/companies/${id}/employees/${confirmDelete.id}`);
      toast.success(t('employees.deletedToast', { name: confirmDelete.name }));
      setConfirmDelete(null);
      await mutate();
    } catch (err) {
      toast.error(t('common.error'), { description: err instanceof Error ? err.message : t('employees.deleteError') });
    } finally {
      setActing(null);
    }
  }, [confirmDelete, id, mutate, toast, t]);

  // Prune selection when the visible roster changes (e.g. filters / refresh).
  React.useEffect(() => {
    setSelectedIds((prev) => {
      const visible = new Set(rows.map((r) => r.id));
      let changed = false;
      const next = new Set<string>();
      for (const sid of prev) {
        if (visible.has(sid)) next.add(sid);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [rows]);

  const toggleRow = React.useCallback((rowId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }, []);

  const toggleAll = React.useCallback(
    (checked: boolean) => {
      setSelectedIds(checked ? new Set(rows.map((r) => r.id)) : new Set());
    },
    [rows],
  );

  const clearSelection = React.useCallback(() => setSelectedIds(new Set()), []);

  const runBulk = React.useCallback(
    async (patch: { departmentId?: string | null; shiftId?: string | null; status?: 'ACTIVE' | 'INACTIVE' }) => {
      if (!id || selectedIds.size === 0) return;
      setBulkRunning(true);
      try {
        const res = await api.patch<{ updated: number }>(`/api/companies/${id}/employees/bulk`, {
          employeeIds: Array.from(selectedIds),
          ...patch,
        });
        toast.success(t('employees.bulkDone', { count: String(res?.updated ?? selectedIds.size) }));
        clearSelection();
        await mutate();
      } catch (err) {
        toast.error(t('common.error'), { description: err instanceof Error ? err.message : '' });
      } finally {
        setBulkRunning(false);
      }
    },
    [id, selectedIds, toast, t, clearSelection, mutate],
  );

  const hasDepartments = departments.length > 0;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[10px] uppercase tracking-[0.28em] text-[#6b6966]">
            {t('employees.eyebrow')}
          </div>
          <h1
            className="mt-2 text-3xl sm:text-4xl md:text-5xl lg:text-6xl tracking-tight text-[#3d3b38]"
            style={{ fontFamily: 'Fraunces, serif', fontWeight: 400 }}
          >
            {t('employees.title')}
          </h1>
          <div className="mt-1 text-sm text-[#6b6966]">
            {data ? t('employees.count', { count: String(data.items.length) }) : '—'}
          </div>
        </div>
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 flex-wrap">
          {hasDepartments && (
            <button
              type="button"
              onClick={() => setShowDeptAssign((v) => !v)}
              className={cn(
                'h-10 rounded-full border px-4 text-xs uppercase tracking-[0.22em] transition-colors',
                showDeptAssign
                  ? 'border-[#E98074] bg-[#E98074]/10 text-[#E98074]'
                  : 'border-[#8E8D8A]/30 bg-transparent text-[#6b6966] hover:border-[#E98074]/50 hover:text-[#E98074]',
              )}
            >
              {t('departments.eyebrow')}
            </button>
          )}
          <div className="relative">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('employees.searchPlaceholder')}
              className="h-10 w-full sm:w-56 rounded-full border border-[#8E8D8A]/25 bg-transparent px-4 text-sm text-[#3d3b38] placeholder:text-[#8E8D8A]/60 focus:outline-none focus:border-[#E98074]/60 transition-colors"
            />
          </div>
          <Button variant="primary" onClick={() => setInviteOpen(true)}>
            {t('employees.inviteButton')}
          </Button>
        </div>
      </div>

      {/* Filter toolbar */}
      <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-3">
        <FilterSelect
          value={deptFilter}
          onChange={setDeptFilter}
          options={departments.map((d) => ({ id: d.id, name: d.name }))}
          allLabel={t('employees.filterAllDepartments')}
        />
        <FilterSelect
          value={shiftFilter}
          onChange={setShiftFilter}
          options={shiftOptions.map((s) => ({ id: s.id, name: s.name }))}
          allLabel={t('employees.filterAllShifts')}
        />
        <button
          type="button"
          onClick={() => setAbsentTodayOnly((v) => !v)}
          className={cn(
            'h-10 rounded-full border px-4 text-xs uppercase tracking-[0.22em] transition-colors',
            absentTodayOnly
              ? 'border-[#E85A4F] bg-[#E85A4F]/10 text-[#E85A4F]'
              : 'border-[#8E8D8A]/30 bg-transparent text-[#6b6966] hover:border-[#E85A4F]/50 hover:text-[#E85A4F]',
          )}
        >
          {t('employees.chipAbsentToday')}
        </button>
        <label className="inline-flex items-center gap-2 h-10 px-2 text-sm text-[#3d3b38] cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="h-4 w-4 accent-[#E98074]"
          />
          {t('employees.showInactive')}
        </label>
      </div>

      {/* Bulk selection toolbar */}
      {selectedIds.size > 0 && (
        <div className="sticky top-2 z-20 flex flex-wrap items-center gap-3 rounded-2xl border border-[#8E8D8A]/30 bg-[#EAE7DC]/95 backdrop-blur px-4 py-3 shadow-sm">
          <span className="text-xs uppercase tracking-[0.22em] text-[#6b6966]">
            {t('employees.bulkSelected', { count: String(selectedIds.size) })}
          </span>
          <Dropdown
            align="left"
            trigger={
              <span className="inline-flex items-center gap-2 h-9 rounded-full border border-[#8E8D8A]/25 bg-transparent px-4 text-sm text-[#3d3b38] hover:border-[#E98074]/50 transition-colors">
                {t('employees.bulkAssignDept')}
                <span aria-hidden className="text-[10px] text-[#8E8D8A]">▾</span>
              </span>
            }
            menuClassName="max-h-64 overflow-y-auto"
          >
            <DropdownItem onClick={() => void runBulk({ departmentId: null })}>
              {t('employees.bulkNoDept')}
            </DropdownItem>
            {departments.map((d) => (
              <DropdownItem key={d.id} onClick={() => void runBulk({ departmentId: d.id })}>
                {d.name}
              </DropdownItem>
            ))}
          </Dropdown>
          <Dropdown
            align="left"
            trigger={
              <span className="inline-flex items-center gap-2 h-9 rounded-full border border-[#8E8D8A]/25 bg-transparent px-4 text-sm text-[#3d3b38] hover:border-[#E98074]/50 transition-colors">
                {t('employees.bulkAssignShift')}
                <span aria-hidden className="text-[10px] text-[#8E8D8A]">▾</span>
              </span>
            }
            menuClassName="max-h-64 overflow-y-auto"
          >
            <DropdownItem onClick={() => void runBulk({ shiftId: null })}>
              {t('employees.bulkNoShift')}
            </DropdownItem>
            {shifts.map((s) => (
              <DropdownItem key={s.id} onClick={() => void runBulk({ shiftId: s.id })}>
                {s.name}
              </DropdownItem>
            ))}
          </Dropdown>
          <button
            type="button"
            disabled={bulkRunning}
            onClick={() => setConfirmBulkDeactivate(true)}
            className="h-9 rounded-full border border-[#E85A4F]/40 bg-transparent px-4 text-sm text-[#E85A4F] hover:bg-[#E85A4F]/10 disabled:opacity-50 transition-colors"
          >
            {t('employees.bulkDeactivate')}
          </button>
          <button
            type="button"
            onClick={clearSelection}
            className="ml-auto h-9 rounded-full px-3 text-xs uppercase tracking-[0.22em] text-[#6b6966] hover:text-[#3d3b38] transition-colors"
          >
            {t('common.cancel')}
          </button>
        </div>
      )}

      <Card className="!p-0">
        {companyErr || error ? (
          <ErrorState onRetry={() => mutate()} label={t('employees.loadError')} />
        ) : isLoading || !data ? (
          <div className="p-6 flex flex-col gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : showDeptAssign && hasDepartments && id ? (
          <EmployeesWithDepartments
            rows={rows}
            departments={departments}
            companyId={id}
            acting={acting}
            onMenu={handleMenu}
            onAssigned={() => void mutate()}
            onSelect={goToProfile}
          />
        ) : (
          <EmployeesTable
            rows={rows}
            acting={acting}
            onMenu={handleMenu}
            onSelect={goToProfile}
            selectedIds={selectedIds}
            onToggleRow={toggleRow}
            onToggleAll={toggleAll}
          />
        )}
      </Card>

      {id && (
        <InviteModal
          companyId={id}
          open={inviteOpen}
          onClose={() => setInviteOpen(false)}
          onInvited={() => mutate()}
        />
      )}

      {id && (
        <EditEmployeeModal
          employee={editing}
          companyId={id}
          open={editing !== null}
          onClose={() => setEditing(null)}
          onSaved={() => mutate()}
        />
      )}

      {/* Bulk deactivate confirmation */}
      {confirmBulkDeactivate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-[#2a2927]/40 backdrop-blur-sm"
            onClick={() => setConfirmBulkDeactivate(false)}
          />
          <div className="relative w-full max-w-sm bg-[#EAE7DC] border border-[#8E8D8A]/20 rounded-2xl shadow-2xl p-8 text-center">
            <div className="text-2xl text-[#2a2927] mb-2" style={{ fontFamily: 'Fraunces, serif' }}>
              {t('employees.bulkDeactivate')}
            </div>
            <p className="text-sm text-[#6b6966] mb-6">
              {t('employees.bulkConfirmDeactivate', { count: String(selectedIds.size) })}
            </p>
            <div className="flex gap-3">
              <Button
                variant="ghost"
                className="flex-1"
                onClick={() => setConfirmBulkDeactivate(false)}
                disabled={bulkRunning}
              >
                {t('common.cancel')}
              </Button>
              <button
                onClick={() => {
                  setConfirmBulkDeactivate(false);
                  void runBulk({ status: 'INACTIVE' });
                }}
                disabled={bulkRunning}
                className="flex-1 h-10 rounded-lg bg-[#E85A4F] text-white text-sm tracking-tight hover:bg-[#d44f44] disabled:opacity-50 transition-colors"
              >
                {t('common.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-[#2a2927]/40 backdrop-blur-sm" onClick={() => setConfirmDelete(null)} />
          <div className="relative w-full max-w-sm bg-[#EAE7DC] border border-[#8E8D8A]/20 rounded-2xl shadow-2xl p-8 text-center">
            <div
              className="text-2xl text-[#2a2927] mb-2"
              style={{ fontFamily: 'Fraunces, serif' }}
            >
              {t('employees.deleteTitle')}
            </div>
            <p className="text-sm text-[#6b6966] mb-6">
              {t('employees.deleteBody', { name: confirmDelete.name })}
            </p>
            <div className="flex gap-3">
              <Button
                variant="ghost"
                className="flex-1"
                onClick={() => setConfirmDelete(null)}
                disabled={acting === confirmDelete.id}
              >
                {t('common.cancel')}
              </Button>
              <button
                onClick={handleDelete}
                disabled={acting === confirmDelete.id}
                className="flex-1 h-10 rounded-lg bg-[#E85A4F] text-white text-sm tracking-tight hover:bg-[#d44f44] disabled:opacity-50 transition-colors"
              >
                {acting === confirmDelete.id ? t('common.deleting') : t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
