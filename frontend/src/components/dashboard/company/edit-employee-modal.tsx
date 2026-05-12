'use client';

import * as React from 'react';
import { Button } from '@tact/ui';
import { api } from '@/lib/api';
import { useToast } from '@/components/ui/use-toast';
import { useLang } from '@/i18n/context';
import type { Employee } from './employees-table';

export interface EditEmployeeModalProps {
  employee: Employee | null;
  companyId: string;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

type EmployeeRoleValue = 'OWNER' | 'MANAGER' | 'ACCOUNTANT' | 'HR' | 'STAFF';

type FormState = {
  position: string;
  role: EmployeeRoleValue;
  monthlySalary: string;
  hourlyRate: string;
};

export function EditEmployeeModal({ employee, companyId, open, onClose, onSaved }: EditEmployeeModalProps) {
  const toast = useToast();
  const { t } = useLang();
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState<FormState>({
    position: '',
    role: 'STAFF',
    monthlySalary: '',
    hourlyRate: '',
  });

  React.useEffect(() => {
    if (employee) {
      setForm({
        position: employee.position ?? '',
        role: employee.role,
        monthlySalary: employee.monthlySalary != null ? String(employee.monthlySalary) : '',
        hourlyRate: employee.hourlyRate != null ? String(employee.hourlyRate) : '',
      });
    }
  }, [employee]);

  if (!open || !employee) return null;

  const set = (key: keyof FormState, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.patch(`/api/companies/${companyId}/employees/${employee.id}`, {
        position: form.position || undefined,
        role: form.role,
        monthlySalary: form.monthlySalary ? Number(form.monthlySalary) : null,
        hourlyRate: form.hourlyRate ? Number(form.hourlyRate) : null,
      });
      toast.success(t('employees.editSaved'));
      onSaved();
      onClose();
    } catch (err) {
      toast.error(t('common.error'), { description: err instanceof Error ? err.message : t('employees.editError') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[#2a2927]/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-[#EAE7DC] border border-[#8E8D8A]/20 rounded-2xl shadow-2xl p-8">
        <div className="mb-6">
          <div className="text-[10px] uppercase tracking-[0.28em] text-[#6b6966] mb-1">
            {t('employees.editEyebrow')}
          </div>
          <h2
            className="text-3xl tracking-tight text-[#2a2927]"
            style={{ fontFamily: 'Fraunces, serif', fontWeight: 400 }}
          >
            {employee.name}
          </h2>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-5">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-[0.22em] text-[#6b6966]">
              {t('employees.editPositionLabel')}
            </span>
            <input
              value={form.position}
              onChange={(e) => set('position', e.target.value)}
              placeholder={t('employees.editPositionPlaceholder')}
              className="h-10 rounded-lg border border-[#8E8D8A]/30 bg-transparent px-3 text-sm text-[#3d3b38] placeholder:text-[#8E8D8A]/50 focus:outline-none focus:border-[#E98074]/60 transition-colors"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-[0.22em] text-[#6b6966]">
              {t('employees.editRoleLabel')}
            </span>
            <select
              value={form.role}
              onChange={(e) => set('role', e.target.value as FormState['role'])}
              className="h-10 rounded-lg border border-[#8E8D8A]/30 bg-[#EAE7DC] px-3 text-sm text-[#3d3b38] focus:outline-none focus:border-[#E98074]/60 transition-colors"
            >
              <option value="STAFF">{t('employees.roleStaff')}</option>
              <option value="MANAGER">{t('employees.roleManager')}</option>
              <option value="ACCOUNTANT">{t('employees.roleAccountant')}</option>
              <option value="HR">{t('employees.roleHr')}</option>
              <option value="OWNER">{t('employees.roleOwner')}</option>
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.22em] text-[#6b6966]">
                {t('employees.editSalaryLabel')}
              </span>
              <input
                type="number"
                value={form.monthlySalary}
                onChange={(e) => set('monthlySalary', e.target.value)}
                placeholder="150000"
                min="0"
                className="h-10 rounded-lg border border-[#8E8D8A]/30 bg-transparent px-3 text-sm text-[#3d3b38] placeholder:text-[#8E8D8A]/50 focus:outline-none focus:border-[#E98074]/60 transition-colors"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.22em] text-[#6b6966]">
                {t('employees.editRateLabel')}
              </span>
              <input
                type="number"
                value={form.hourlyRate}
                onChange={(e) => set('hourlyRate', e.target.value)}
                placeholder="1200"
                min="0"
                className="h-10 rounded-lg border border-[#8E8D8A]/30 bg-transparent px-3 text-sm text-[#3d3b38] placeholder:text-[#8E8D8A]/50 focus:outline-none focus:border-[#E98074]/60 transition-colors"
              />
            </label>
          </div>

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="ghost" className="flex-1" onClick={onClose} disabled={saving}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="primary" className="flex-1" disabled={saving}>
              {saving ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
