'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import { useParams, useRouter } from 'next/navigation';
import useSWR from 'swr';
import { Button, Card, Input, cn } from '@tact/ui';
import { fetcher } from '@/lib/fetcher';
import { api } from '@/lib/api';
import { useToast } from '@/components/ui/use-toast';
import { useLang } from '@/i18n/context';

// Leaflet touches `window`, so the map must be client-only (no SSR).
const GeofenceMap = dynamic(
  () => import('@/components/dashboard/company/geofence-map'),
  { ssr: false },
);

// ---------------------------------------------------------------------------
// Location types
// ---------------------------------------------------------------------------
type Location = {
  id: string;
  companyId: string;
  name: string;
  address?: string | null;
  latitude: number;
  longitude: number;
  geofenceRadiusM: number;
  createdAt: string;
};

/**
 * Shape returned by `GET /api/companies/:slug`. The backend resolves the
 * membership and annotates `myRole` on the payload so the UI can gate owner
 * features without a second round-trip.
 */
type CompanyDetail = {
  id: string;
  slug: string;
  name: string;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  geofenceRadiusM?: number | null;
  workStartHour?: number | null;
  workEndHour?: number | null;
  timezone?: string | null;
  latePenaltyEnabled?: boolean | null;
  latePenaltyGraceMin?: number | null;
  latePenaltyAmount?: number | null;
  latePenaltyPercent?: number | null;
  myRole?: 'OWNER' | 'MANAGER' | 'EMPLOYEE' | string;
};

const TIMEZONES = [
  'Asia/Almaty',
  'Asia/Aqtobe',
  'Asia/Qyzylorda',
  'Asia/Atyrau',
  'Asia/Oral',
  'Europe/Moscow',
  'UTC',
];

/** Convert integer hour (0–23) to `HH:00` for `<input type="time">`. */
function hourToTimeStr(h: number | null | undefined): string {
  if (h == null || Number.isNaN(h)) return '';
  const hh = Math.max(0, Math.min(23, Math.floor(h)));
  return `${String(hh).padStart(2, '0')}:00`;
}

/** Parse the `HH:MM` value back to an integer hour — backend wants int, not float. */
function timeStrToHour(s: string): number | null {
  if (!s) return null;
  const [hh] = s.split(':').map((x) => parseInt(x, 10));
  if (Number.isNaN(hh)) return null;
  return Math.max(0, Math.min(23, hh));
}

// ---------------------------------------------------------------------------
// Departments card — isolated sub-component with its own SWR + state
// ---------------------------------------------------------------------------
type Department = {
  id: string;
  name: string;
  employeeCount: number;
  createdAt: string;
};

function DepartmentsCard({ companyId }: { companyId: string }) {
  const { t } = useLang();
  const toast = useToast();

  const { data: departments, mutate: mutateDepts } = useSWR<Department[]>(
    `/api/companies/${companyId}/departments`,
    fetcher,
  );

  const [newName, setNewName] = React.useState('');
  const [adding, setAdding] = React.useState(false);

  const handleAdd = async () => {
    const name = newName.trim();
    if (!name) return;
    setAdding(true);
    try {
      await api.post<Department>(`/api/companies/${companyId}/departments`, { name });
      await mutateDepts();
      setNewName('');
      toast.success(t('departments.addDepartment'));
    } catch (err: unknown) {
      toast.error(t('departments.createError'), {
        description: (err as Error)?.message ?? '',
      });
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (dept: Department) => {
    if (!confirm(t('departments.deleteConfirm', { name: dept.name }))) return;
    try {
      await api.delete(`/api/companies/${companyId}/departments/${dept.id}`);
      await mutateDepts();
      toast.success(t('departments.deleted'));
    } catch (err: unknown) {
      toast.error(t('departments.deleteError'), {
        description: (err as Error)?.message ?? '',
      });
    }
  };

  return (
    <Card eyebrow={t('departments.eyebrow')} title={t('departments.title')}>
      {/* Existing departments list */}
      {departments && departments.length > 0 ? (
        <div className="mb-6 flex flex-col gap-2">
          {departments.map((dept) => (
            <div
              key={dept.id}
              className="flex items-center justify-between gap-4 rounded-xl border border-[#8E8D8A]/20 bg-[#F5F0EA]/60 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-[#3d3b38] truncate">{dept.name}</div>
                <div className="mt-0.5 text-[10px] uppercase tracking-[0.22em] text-[#8E8D8A]">
                  <span
                    className="tabular-nums"
                    style={{ fontFamily: 'Fraunces, serif' }}
                  >
                    {dept.employeeCount}
                  </span>{' '}
                  {t('departments.employeeCount')}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0 !text-[#E85A4F] !border-[#E85A4F]/30 hover:!bg-[#E85A4F]/10"
                onClick={() => handleDelete(dept)}
              >
                {t('departments.deleteDepartment')}
              </Button>
            </div>
          ))}
        </div>
      ) : departments && departments.length === 0 ? (
        <div className="mb-6 rounded-xl border border-[#8E8D8A]/20 bg-[#F5F0EA]/40 px-4 py-6 text-center">
          <div className="mt-1 text-[11px] text-[#8E8D8A]">{t('departments.emptyHint')}</div>
        </div>
      ) : null}

      {/* Add department inline form */}
      <div className="border-t border-[#8E8D8A]/20 pt-5">
        <div className="flex items-center gap-3">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t('departments.namePlaceholder')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleAdd();
            }}
            className="flex-1"
          />
          <Button
            onClick={handleAdd}
            disabled={adding || !newName.trim()}
          >
            {adding ? t('common.saving') : t('departments.addDepartment')}
          </Button>
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Shifts card — isolated sub-component with its own SWR + state
// ---------------------------------------------------------------------------
type Shift = {
  id: string;
  name: string;
  startHour: number;
  endHour: number;
  employeeCount: number;
  createdAt: string;
};

function ShiftsCard({ companyId }: { companyId: string }) {
  const { t } = useLang();
  const toast = useToast();

  const { data: shifts, mutate: mutateShifts } = useSWR<Shift[]>(
    `/api/companies/${companyId}/shifts`,
    fetcher,
  );

  const [newName, setNewName] = React.useState('');
  const [newStart, setNewStart] = React.useState('');
  const [newEnd, setNewEnd] = React.useState('');
  const [adding, setAdding] = React.useState(false);

  const isValid = newName.trim() && newStart && newEnd;

  const handleAdd = async () => {
    const name = newName.trim();
    const startHour = timeStrToHour(newStart);
    const endHour = timeStrToHour(newEnd);
    if (!name || startHour == null || endHour == null) return;
    setAdding(true);
    try {
      await api.post<Shift>(`/api/companies/${companyId}/shifts`, { name, startHour, endHour });
      await mutateShifts();
      setNewName('');
      setNewStart('');
      setNewEnd('');
      toast.success(t('shifts.created'));
    } catch (err: unknown) {
      toast.error(t('shifts.createError'), {
        description: (err as Error)?.message ?? '',
      });
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (shift: Shift) => {
    if (!confirm(t('shifts.deleteConfirm', { name: shift.name }))) return;
    try {
      await api.delete(`/api/companies/${companyId}/shifts/${shift.id}`);
      await mutateShifts();
      toast.success(t('shifts.deleted'));
    } catch (err: unknown) {
      toast.error(t('shifts.deleteError'), {
        description: (err as Error)?.message ?? '',
      });
    }
  };

  return (
    <Card eyebrow={t('shifts.eyebrow')} title={t('shifts.title')}>
      {/* Existing shifts list */}
      {shifts && shifts.length > 0 ? (
        <div className="mb-6 flex flex-col gap-2">
          {shifts.map((shift) => (
            <div
              key={shift.id}
              className="flex items-center justify-between gap-4 rounded-xl border border-[#8E8D8A]/20 bg-[#F5F0EA]/60 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-[#3d3b38] truncate">{shift.name}</div>
                <div className="mt-0.5 text-[10px] uppercase tracking-[0.22em] text-[#8E8D8A]">
                  <span style={{ fontFamily: 'Fraunces, serif' }}>
                    {hourToTimeStr(shift.startHour)} – {hourToTimeStr(shift.endHour)}
                  </span>
                  {' · '}
                  <span className="tabular-nums" style={{ fontFamily: 'Fraunces, serif' }}>
                    {shift.employeeCount}
                  </span>{' '}
                  {t('shifts.employeeCount')}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0 !text-[#E85A4F] !border-[#E85A4F]/30 hover:!bg-[#E85A4F]/10"
                onClick={() => handleDelete(shift)}
              >
                {t('shifts.deleteShift')}
              </Button>
            </div>
          ))}
        </div>
      ) : shifts && shifts.length === 0 ? (
        <div className="mb-6 rounded-xl border border-[#8E8D8A]/20 bg-[#F5F0EA]/40 px-4 py-6 text-center">
          <div className="mt-1 text-[11px] text-[#8E8D8A]">{t('shifts.noShifts')}</div>
        </div>
      ) : null}

      {/* Add shift inline form */}
      <div className="border-t border-[#8E8D8A]/20 pt-5">
        <div className="grid gap-5 grid-cols-1 sm:grid-cols-2 md:grid-cols-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] uppercase tracking-[0.24em] text-[#6b6966]">
              {t('shifts.nameLabel')}
            </span>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t('shifts.nameLabel')}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleAdd();
              }}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] uppercase tracking-[0.24em] text-[#6b6966]">
              {t('shifts.startLabel')}
            </span>
            <Input
              type="time"
              step={3600}
              value={newStart}
              onChange={(e) => setNewStart(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] uppercase tracking-[0.24em] text-[#6b6966]">
              {t('shifts.endLabel')}
            </span>
            <Input
              type="time"
              step={3600}
              value={newEnd}
              onChange={(e) => setNewEnd(e.target.value)}
            />
          </label>
        </div>
        <div className="mt-5">
          <Button onClick={handleAdd} disabled={adding || !isValid}>
            {adding ? t('common.saving') : t('shifts.addShift')}
          </Button>
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Holidays card — company calendar of non-working days
// ---------------------------------------------------------------------------
type Holiday = {
  id: string;
  date: string; // YYYY-MM-DD
  name: string;
};

function HolidaysCard({ companyId }: { companyId: string }) {
  const { t } = useLang();
  const toast = useToast();

  const { data: holidays, mutate: mutateHolidays } = useSWR<Holiday[]>(
    `/api/companies/${companyId}/holidays`,
    fetcher,
  );

  const [newDate, setNewDate] = React.useState('');
  const [newName, setNewName] = React.useState('');
  const [adding, setAdding] = React.useState(false);

  const isValid = !!newDate && !!newName.trim();

  const handleAdd = async () => {
    if (!isValid) return;
    setAdding(true);
    try {
      await api.post<Holiday>(`/api/companies/${companyId}/holidays`, {
        date: newDate,
        name: newName.trim(),
      });
      await mutateHolidays();
      setNewDate('');
      setNewName('');
      toast.success(t('settings.holidayAdd'));
    } catch (err: unknown) {
      toast.error(t('settings.saveError'), {
        description: (err as Error)?.message ?? '',
      });
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (h: Holiday) => {
    if (!confirm(`${h.date} — ${h.name}?`)) return;
    try {
      await api.delete(`/api/companies/${companyId}/holidays/${h.id}`);
      await mutateHolidays();
    } catch (err: unknown) {
      toast.error(t('settings.deleteError'), {
        description: (err as Error)?.message ?? '',
      });
    }
  };

  const sorted = React.useMemo(
    () => (holidays ? [...holidays].sort((a, b) => a.date.localeCompare(b.date)) : []),
    [holidays],
  );

  return (
    <Card eyebrow={t('settings.scheduleEyebrow')} title={t('settings.holidaysTitle')}>
      {/* Existing holidays list */}
      {sorted.length > 0 ? (
        <div className="mb-6 flex flex-col gap-2">
          {sorted.map((h) => (
            <div
              key={h.id}
              className="flex items-center justify-between gap-4 rounded-xl border border-[#8E8D8A]/20 bg-[#F5F0EA]/60 px-4 py-3"
            >
              <div className="min-w-0 flex-1 flex items-baseline gap-3">
                <span
                  className="tabular-nums text-sm text-[#3d3b38] shrink-0"
                  style={{ fontFamily: 'Fraunces, serif' }}
                >
                  {h.date}
                </span>
                <span className="text-sm text-[#6b6966] truncate">{h.name}</span>
              </div>
              <button
                type="button"
                aria-label="delete"
                onClick={() => handleDelete(h)}
                className="shrink-0 h-7 w-7 rounded-full text-[#E85A4F] hover:bg-[#E85A4F]/10 leading-none text-base"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : holidays && holidays.length === 0 ? (
        <div className="mb-6 rounded-xl border border-[#8E8D8A]/20 bg-[#F5F0EA]/40 px-4 py-6 text-center">
          <div className="text-[11px] text-[#8E8D8A]">{t('settings.holidaysEmpty')}</div>
        </div>
      ) : null}

      {/* Add holiday inline form */}
      <div className="border-t border-[#8E8D8A]/20 pt-5">
        <div className="grid gap-5 grid-cols-1 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] uppercase tracking-[0.24em] text-[#6b6966]">
              {t('settings.holidayDate')}
            </span>
            <Input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] uppercase tracking-[0.24em] text-[#6b6966]">
              {t('settings.holidayName')}
            </span>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t('settings.holidayName')}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleAdd();
              }}
            />
          </label>
        </div>
        <div className="mt-5">
          <Button onClick={handleAdd} disabled={adding || !isValid}>
            {adding ? t('common.saving') : t('settings.holidayAdd')}
          </Button>
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Locations card — isolated sub-component with its own SWR + state
// ---------------------------------------------------------------------------
function LocationsCard({ companyId }: { companyId: string }) {
  const { t } = useLang();
  const toast = useToast();

  const { data: locations, mutate: mutateLocations } = useSWR<Location[]>(
    `/api/companies/${companyId}/locations`,
    fetcher,
  );

  // New-location form state
  const emptyForm = {
    name: '',
    address: '',
    latitude: '',
    longitude: '',
    geofenceRadiusM: 150,
  };
  const [newLoc, setNewLoc] = React.useState(emptyForm);
  const [adding, setAdding] = React.useState(false);

  const updateNew = <K extends keyof typeof emptyForm>(k: K, v: (typeof emptyForm)[K]) =>
    setNewLoc((f) => ({ ...f, [k]: v }));

  const handleAdd = async () => {
    if (!newLoc.name.trim() || newLoc.latitude === '' || newLoc.longitude === '') return;
    setAdding(true);
    try {
      await api.post<Location>(`/api/companies/${companyId}/locations`, {
        name: newLoc.name.trim(),
        address: newLoc.address.trim() || undefined,
        latitude: Number(newLoc.latitude),
        longitude: Number(newLoc.longitude),
        geofenceRadiusM: newLoc.geofenceRadiusM,
      });
      await mutateLocations();
      setNewLoc(emptyForm);
      toast.success(t('locations.created'));
    } catch (err: unknown) {
      toast.error(t('locations.createError'), {
        description: (err as Error)?.message ?? '',
      });
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (loc: Location) => {
    if (!confirm(t('locations.deleteConfirm', { name: loc.name }))) return;
    try {
      await api.delete(`/api/companies/${companyId}/locations/${loc.id}`);
      await mutateLocations();
      toast.success(t('locations.deleted'));
    } catch (err: unknown) {
      toast.error(t('locations.deleteError'), {
        description: (err as Error)?.message ?? '',
      });
    }
  };

  const radius = newLoc.geofenceRadiusM;

  return (
    <Card eyebrow={t('locations.eyebrow')} title={t('locations.title')}>
      {/* Existing locations list */}
      {locations && locations.length > 0 ? (
        <div className="mb-6 flex flex-col gap-2">
          {locations.map((loc) => (
            <div
              key={loc.id}
              className="flex items-start justify-between gap-4 rounded-xl border border-[#8E8D8A]/20 bg-[#F5F0EA]/60 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-[#3d3b38] truncate">{loc.name}</div>
                {loc.address && (
                  <div className="mt-0.5 text-[11px] text-[#6b6966] truncate">{loc.address}</div>
                )}
                <div className="mt-1 text-[10px] uppercase tracking-[0.22em] text-[#8E8D8A]">
                  {loc.latitude.toFixed(6)}, {loc.longitude.toFixed(6)} ·{' '}
                  <span
                    className="tabular-nums"
                    style={{ fontFamily: 'Fraunces, serif' }}
                  >
                    {loc.geofenceRadiusM}
                  </span>{' '}
                  {t('locations.meters')}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0 !text-[#E85A4F] !border-[#E85A4F]/30 hover:!bg-[#E85A4F]/10"
                onClick={() => handleDelete(loc)}
              >
                {t('locations.deleteLocation')}
              </Button>
            </div>
          ))}
        </div>
      ) : locations && locations.length === 0 ? (
        <div className="mb-6 rounded-xl border border-[#8E8D8A]/20 bg-[#F5F0EA]/40 px-4 py-6 text-center">
          <div className="text-[11px] uppercase tracking-[0.24em] text-[#6b6966]">
            {t('locations.emptyTitle')}
          </div>
          <div className="mt-1 text-[11px] text-[#8E8D8A]">{t('locations.emptyHint')}</div>
        </div>
      ) : null}

      {/* Add location form */}
      <div className="border-t border-[#8E8D8A]/20 pt-5">
        <div className="text-[10px] uppercase tracking-[0.28em] text-[#6b6966] mb-4">
          {t('locations.addLocation')}
        </div>
        <div className="grid gap-5 grid-cols-1 md:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] uppercase tracking-[0.24em] text-[#6b6966]">
              {t('locations.nameLabel')}
            </span>
            <Input
              value={newLoc.name}
              onChange={(e) => updateNew('name', e.target.value)}
              placeholder={t('locations.namePlaceholder')}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] uppercase tracking-[0.24em] text-[#6b6966]">
              {t('locations.addressLabel')}
            </span>
            <Input
              value={newLoc.address}
              onChange={(e) => updateNew('address', e.target.value)}
              placeholder={t('locations.addressPlaceholder')}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] uppercase tracking-[0.24em] text-[#6b6966]">
              {t('locations.latitude')}
            </span>
            <Input
              type="number"
              step="0.000001"
              value={newLoc.latitude}
              onChange={(e) => updateNew('latitude', e.target.value as unknown as string)}
              placeholder="43.238949"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] uppercase tracking-[0.24em] text-[#6b6966]">
              {t('locations.longitude')}
            </span>
            <Input
              type="number"
              step="0.000001"
              value={newLoc.longitude}
              onChange={(e) => updateNew('longitude', e.target.value as unknown as string)}
              placeholder="76.889709"
            />
          </label>
        </div>

        {/* Radius slider — matches existing geofence slider style exactly */}
        <div className="mt-5">
          <div className="flex items-baseline justify-between">
            <span className="text-[10px] uppercase tracking-[0.24em] text-[#6b6966]">
              {t('locations.radius')}
            </span>
            <span
              className="tabular-nums text-2xl text-[#3d3b38]"
              style={{ fontFamily: 'Fraunces, serif' }}
            >
              {radius}
              <span className="ml-1 text-[11px] uppercase tracking-[0.22em] text-[#6b6966]">
                {t('locations.meters')}
              </span>
            </span>
          </div>
          <input
            type="range"
            min={20}
            max={2000}
            step={10}
            value={radius}
            onChange={(e) => updateNew('geofenceRadiusM', Number(e.target.value))}
            className={cn(
              'mt-3 w-full appearance-none bg-transparent',
              '[&::-webkit-slider-runnable-track]:h-[2px]',
              '[&::-webkit-slider-runnable-track]:bg-[#8E8D8A]/30',
              '[&::-webkit-slider-runnable-track]:rounded-full',
              '[&::-webkit-slider-thumb]:appearance-none',
              '[&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5',
              '[&::-webkit-slider-thumb]:bg-[#E98074]',
              '[&::-webkit-slider-thumb]:rounded-full',
              '[&::-webkit-slider-thumb]:-mt-[9px]',
              '[&::-webkit-slider-thumb]:shadow',
            )}
          />
          <div className="mt-2 flex justify-between text-[10px] uppercase tracking-[0.22em] text-[#6b6966]">
            <span>20 {t('locations.meters')}</span>
            <span>2000 {t('locations.meters')}</span>
          </div>
        </div>

        <div className="mt-5">
          <Button onClick={handleAdd} disabled={adding || !newLoc.name.trim() || newLoc.latitude === '' || newLoc.longitude === ''}>
            {adding ? t('locations.adding') : t('locations.addLocation')}
          </Button>
        </div>
      </div>
    </Card>
  );
}

export default function SettingsPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const slug = params?.slug;
  const toast = useToast();
  const { t } = useLang();
  const [deleting, setDeleting] = React.useState(false);

  const swrKey = slug ? `/api/companies/${slug}` : null;
  const { data, mutate, error, isLoading } = useSWR<CompanyDetail>(swrKey, fetcher);

  // Saved locations — used to draw read-only geofence circles on the map.
  const { data: locations } = useSWR<Location[]>(
    data?.id ? `/api/companies/${data.id}/locations` : null,
    fetcher,
  );

  const [form, setForm] = React.useState<CompanyDetail | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [saveErr, setSaveErr] = React.useState<string | null>(null);

  // Populate the form once the server response lands. We intentionally only
  // hydrate when the user hasn't started editing (form === null) so in-flight
  // edits survive background revalidation.
  React.useEffect(() => {
    if (data && !form) {
      setForm(data);
    }
  }, [data, form]);

  if (error) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-[#E85A4F] tracking-tight">
          {t('settings.loadError')}
        </p>
        <Button variant="ghost" size="sm" className="mt-3" onClick={() => mutate()}>
          {t('common.retry')}
        </Button>
      </div>
    );
  }

  if (isLoading || !data || !form) {
    return (
      <div className="flex flex-col gap-6">
        <div className="h-16 w-64 rounded-md bg-[#D8C3A5]/40 animate-pulse" />
        <div className="h-96 w-full rounded-2xl bg-[#D8C3A5]/30 animate-pulse" />
      </div>
    );
  }

  // Role gate — only OWNER sees the settings form. MANAGER / EMPLOYEE get a
  // "no access" screen even though the PATCH endpoint also admits MANAGER,
  // because the product surface here is owner-only.
  if (data.myRole !== 'OWNER') {
    return (
      <div className="py-24 text-center">
        <div className="text-[10px] uppercase tracking-[0.28em] text-[#6b6966]">
          {t('settings.accessEyebrow')}
        </div>
        <h1
          className="mt-3 text-2xl sm:text-3xl md:text-4xl tracking-tight text-[#3d3b38]"
          style={{ fontFamily: 'Fraunces, serif', fontWeight: 400 }}
        >
          {t('settings.accessDenied')}
        </h1>
        <p className="mt-3 text-sm text-[#6b6966]">
          {t('settings.accessDeniedHint')}
        </p>
      </div>
    );
  }

  const update = <K extends keyof CompanyDetail>(k: K, v: CompanyDetail[K]) =>
    setForm((f) => (f ? { ...f, [k]: v } : f));

  const save = async () => {
    if (!form) return;
    setSaving(true);
    setSaveErr(null);
    try {
      // Only send keys the UpdateCompanyDto schema accepts. Note backend uses
      // `latitude`/`longitude` (not `lat`/`lng`) and integer `workStartHour` /
      // `workEndHour` in 0–23.
      const payload: Record<string, unknown> = {
        name: form.name,
      };
      if (form.address != null) payload.address = form.address;
      if (form.latitude != null) payload.latitude = form.latitude;
      if (form.longitude != null) payload.longitude = form.longitude;
      if (form.geofenceRadiusM != null) payload.geofenceRadiusM = form.geofenceRadiusM;
      if (form.workStartHour != null) payload.workStartHour = Math.floor(form.workStartHour);
      if (form.workEndHour != null) payload.workEndHour = Math.floor(form.workEndHour);
      if (form.timezone != null) payload.timezone = form.timezone;
      payload.latePenaltyEnabled = !!form.latePenaltyEnabled;
      if (form.latePenaltyGraceMin != null)
        payload.latePenaltyGraceMin = Math.max(0, Math.floor(form.latePenaltyGraceMin));
      payload.latePenaltyAmount =
        form.latePenaltyAmount != null && Number.isFinite(form.latePenaltyAmount)
          ? form.latePenaltyAmount
          : null;
      payload.latePenaltyPercent =
        form.latePenaltyPercent != null && Number.isFinite(form.latePenaltyPercent)
          ? form.latePenaltyPercent
          : null;

      const updated = await api.patch<CompanyDetail>(`/api/companies/${form.id}`, payload);
      // Optimistically write the server response, then revalidate so the SWR
      // cache reflects the authoritative state (including any fields the
      // server normalized).
      setForm((prev) => ({ ...(prev ?? updated), ...updated }));
      await mutate(
        (cur) => ({ ...(cur ?? updated), ...updated }),
        { revalidate: true },
      );
      toast.success(t('common.saved'), { description: t('settings.savedHint') });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('settings.saveFailed');
      setSaveErr(msg);
      toast.error(t('settings.saveError'), { description: msg });
    } finally {
      setSaving(false);
    }
  };

  const radius = form.geofenceRadiusM ?? 150;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col sm:flex-row items-start sm:items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[10px] uppercase tracking-[0.28em] text-[#6b6966]">
            {t('settings.settingsEyebrow')}
          </div>
          <h1
            className="mt-2 text-3xl sm:text-4xl md:text-5xl lg:text-6xl tracking-tight text-[#3d3b38]"
            style={{ fontFamily: 'Fraunces, serif', fontWeight: 400 }}
          >
            {t('settings.companyHeading')}
          </h1>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {saveErr && <span className="text-[11px] text-[#E85A4F]">{saveErr}</span>}
          <Button onClick={save} disabled={saving}>
            {saving ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </div>

      <Card eyebrow={t('settings.general')} title={t('settings.generalTitle')}>
        <div className="grid gap-5 grid-cols-1 md:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] uppercase tracking-[0.24em] text-[#6b6966]">
              {t('settings.nameLabel')}
            </span>
            <Input value={form.name ?? ''} onChange={(e) => update('name', e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] uppercase tracking-[0.24em] text-[#6b6966]">
              {t('settings.address')}
            </span>
            <Input
              value={form.address ?? ''}
              onChange={(e) => update('address', e.target.value || null)}
            />
          </label>
        </div>
      </Card>

      <Card eyebrow={t('settings.geoEyebrow')} title={t('settings.geoTitle')}>
        <div className="grid gap-5 grid-cols-1 sm:grid-cols-2 md:grid-cols-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] uppercase tracking-[0.24em] text-[#6b6966]">
              {t('settings.latitude')}
            </span>
            <Input
              type="number"
              step="0.000001"
              value={form.latitude ?? ''}
              onChange={(e) =>
                update('latitude', e.target.value === '' ? null : Number(e.target.value))
              }
              placeholder="43.238949"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] uppercase tracking-[0.24em] text-[#6b6966]">
              {t('settings.longitude')}
            </span>
            <Input
              type="number"
              step="0.000001"
              value={form.longitude ?? ''}
              onChange={(e) =>
                update('longitude', e.target.value === '' ? null : Number(e.target.value))
              }
              placeholder="76.889709"
            />
          </label>
        </div>

        <div className="mt-6">
          <div className="flex items-baseline justify-between">
            <span className="text-[10px] uppercase tracking-[0.24em] text-[#6b6966]">
              {t('settings.geofenceRadius')}
            </span>
            <span
              className="tabular-nums text-2xl text-[#3d3b38]"
              style={{ fontFamily: 'Fraunces, serif' }}
            >
              {radius}
              <span className="ml-1 text-[11px] uppercase tracking-[0.22em] text-[#6b6966]">
                {t('settings.meters')}
              </span>
            </span>
          </div>
          <input
            type="range"
            min={20}
            max={2000}
            step={10}
            value={radius}
            onChange={(e) => update('geofenceRadiusM', Number(e.target.value))}
            className={cn(
              'mt-3 w-full appearance-none bg-transparent',
              '[&::-webkit-slider-runnable-track]:h-[2px]',
              '[&::-webkit-slider-runnable-track]:bg-[#8E8D8A]/30',
              '[&::-webkit-slider-runnable-track]:rounded-full',
              '[&::-webkit-slider-thumb]:appearance-none',
              '[&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5',
              '[&::-webkit-slider-thumb]:bg-[#E98074]',
              '[&::-webkit-slider-thumb]:rounded-full',
              '[&::-webkit-slider-thumb]:-mt-[9px]',
              '[&::-webkit-slider-thumb]:shadow',
            )}
          />
          <div className="mt-2 flex justify-between text-[10px] uppercase tracking-[0.22em] text-[#6b6966]">
            <span>20 {t('settings.meters')}</span>
            <span>2000 {t('settings.meters')}</span>
          </div>
        </div>

        {/* Interactive map — two-way synced with the lat/lng inputs above. */}
        <div className="mt-6">
          <GeofenceMap
            value={
              form.latitude != null && form.longitude != null
                ? { lat: form.latitude, lng: form.longitude }
                : null
            }
            radiusM={radius}
            onChange={({ lat, lng }) => {
              update('latitude', lat);
              update('longitude', lng);
            }}
            locations={(locations ?? []).map((l) => ({
              id: l.id,
              name: l.name,
              latitude: l.latitude,
              longitude: l.longitude,
              geofenceRadiusM: l.geofenceRadiusM,
            }))}
          />
          <div className="mt-2 text-[11px] text-[#8E8D8A]">{t('settings.mapHint')}</div>
        </div>
      </Card>

      <Card eyebrow={t('settings.scheduleEyebrow')} title={t('settings.scheduleTitle')}>
        <div className="grid gap-5 grid-cols-1 sm:grid-cols-2 md:grid-cols-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] uppercase tracking-[0.24em] text-[#6b6966]">
              {t('settings.workStart')}
            </span>
            <Input
              type="time"
              step={3600}
              value={hourToTimeStr(form.workStartHour)}
              onChange={(e) => update('workStartHour', timeStrToHour(e.target.value))}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] uppercase tracking-[0.24em] text-[#6b6966]">
              {t('settings.workEnd')}
            </span>
            <Input
              type="time"
              step={3600}
              value={hourToTimeStr(form.workEndHour)}
              onChange={(e) => update('workEndHour', timeStrToHour(e.target.value))}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] uppercase tracking-[0.24em] text-[#6b6966]">
              {t('settings.timezone')}
            </span>
            <select
              value={form.timezone ?? 'Asia/Almaty'}
              onChange={(e) => update('timezone', e.target.value)}
              className="h-10 rounded-full border border-[#8E8D8A]/30 bg-transparent px-4 text-sm text-[#3d3b38] focus:outline-none focus:border-[#E98074]/60"
            >
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Card>

      <LocationsCard companyId={form.id} />

      <DepartmentsCard companyId={form.id} />

      <ShiftsCard companyId={form.id} />

      <HolidaysCard companyId={form.id} />

      <Card eyebrow={t('settings.penaltyEyebrow')} title={t('settings.penaltyTitle')}>
        <div className="flex flex-col gap-6">
          {/* Enable toggle */}
          <label className="flex items-center justify-between gap-4">
            <span className="text-sm text-[#3d3b38]">{t('settings.penaltyEnabled')}</span>
            <button
              type="button"
              role="switch"
              aria-checked={!!form.latePenaltyEnabled}
              onClick={() => update('latePenaltyEnabled', !form.latePenaltyEnabled)}
              className={cn(
                'relative h-6 w-11 shrink-0 rounded-full transition-colors',
                form.latePenaltyEnabled ? 'bg-[#E98074]' : 'bg-[#8E8D8A]/30',
              )}
            >
              <span
                className={cn(
                  'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
                  form.latePenaltyEnabled ? 'translate-x-[22px]' : 'translate-x-0.5',
                )}
              />
            </button>
          </label>

          <div
            className={cn(
              'flex flex-col gap-6 transition-opacity',
              form.latePenaltyEnabled ? 'opacity-100' : 'opacity-50 pointer-events-none',
            )}
          >
            <label className="flex flex-col gap-1.5 max-w-[220px]">
              <span className="text-[10px] uppercase tracking-[0.24em] text-[#6b6966]">
                {t('settings.penaltyGrace')}
              </span>
              <Input
                type="number"
                min={0}
                step={1}
                value={form.latePenaltyGraceMin ?? 15}
                onChange={(e) =>
                  update(
                    'latePenaltyGraceMin',
                    e.target.value === '' ? null : Math.max(0, Math.floor(Number(e.target.value))),
                  )
                }
              />
            </label>

            <div className="flex flex-col gap-4">
              {/* Fixed amount */}
              <label className="flex items-center gap-3">
                <input
                  type="radio"
                  name="penaltyMode"
                  checked={form.latePenaltyAmount != null}
                  onChange={() => {
                    update('latePenaltyAmount', form.latePenaltyAmount ?? 0);
                    update('latePenaltyPercent', null);
                  }}
                  className="accent-[#E98074]"
                />
                <span className="text-sm text-[#3d3b38]">{t('settings.penaltyModeFixed')}</span>
              </label>
              {form.latePenaltyAmount != null && (
                <label className="flex flex-col gap-1.5 max-w-[220px] pl-7">
                  <span className="text-[10px] uppercase tracking-[0.24em] text-[#6b6966]">
                    {t('settings.penaltyAmount')}
                  </span>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={form.latePenaltyAmount ?? 0}
                    onChange={(e) =>
                      update(
                        'latePenaltyAmount',
                        e.target.value === '' ? 0 : Math.max(0, Number(e.target.value)),
                      )
                    }
                  />
                </label>
              )}

              {/* Percent of daily rate */}
              <label className="flex items-center gap-3">
                <input
                  type="radio"
                  name="penaltyMode"
                  checked={form.latePenaltyAmount == null}
                  onChange={() => {
                    update('latePenaltyAmount', null);
                    update('latePenaltyPercent', form.latePenaltyPercent ?? 0);
                  }}
                  className="accent-[#E98074]"
                />
                <span className="text-sm text-[#3d3b38]">{t('settings.penaltyModePercent')}</span>
              </label>
              {form.latePenaltyAmount == null && (
                <label className="flex flex-col gap-1.5 max-w-[220px] pl-7">
                  <span className="text-[10px] uppercase tracking-[0.24em] text-[#6b6966]">
                    {t('settings.penaltyPercent')}
                  </span>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step="0.1"
                    value={form.latePenaltyPercent ?? 0}
                    onChange={(e) =>
                      update(
                        'latePenaltyPercent',
                        e.target.value === ''
                          ? 0
                          : Math.min(100, Math.max(0, Number(e.target.value))),
                      )
                    }
                  />
                </label>
              )}
            </div>

            <p className="text-[11px] text-[#8E8D8A] leading-relaxed max-w-2xl">
              {t('settings.penaltyHint')}
            </p>
          </div>
        </div>
      </Card>

      <Card className="border border-[#E85A4F]/30">
        <div className="flex flex-col gap-3">
          <div className="text-[10px] uppercase tracking-[0.28em] text-[#E85A4F]">
            {t('settings.dangerZone')}
          </div>
          <p className="text-sm text-[#3d3b38]/80 leading-relaxed">
            {t('settings.deleteCompanyHint')}
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="self-start !text-[#E85A4F] !border-[#E85A4F]/40 hover:!bg-[#E85A4F]/10"
            disabled={deleting}
            onClick={async () => {
              if (!data) return;
              const confirmText = t('settings.deleteConfirm', { name: data.name });
              if (!confirm(confirmText)) return;
              setDeleting(true);
              try {
                await api.delete(`/api/companies/${data.id}`);
                toast.success(t('settings.deleted'), { description: data.name });
                router.push('/dashboard');
              } catch (err) {
                toast.error(t('settings.deleteError'), {
                  description: (err as Error)?.message ?? '',
                });
                setDeleting(false);
              }
            }}
          >
            {deleting ? t('common.deleting') : t('settings.deleteCompany')}
          </Button>
        </div>
      </Card>
    </div>
  );
}
