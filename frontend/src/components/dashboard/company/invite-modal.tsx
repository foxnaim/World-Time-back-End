'use client';

import * as React from 'react';
import { Button, Card, Input, cn } from '@tact/ui';
import { api } from '@/lib/api';
import { useLang } from '@/i18n/context';
import { QrCode } from '@/components/office/qr-code';

export interface InviteModalProps {
  companyId: string;
  open: boolean;
  onClose: () => void;
  onInvited?: (result: InviteResult) => void;
}

/**
 * Shape returned by `POST /api/companies/:id/employees/invite`.
 * Mirrors backend `CompanyService.inviteEmployee`: the service issues a
 * signed Telegram deep-link and we render it as-is (no client-side concat).
 */
type InviteResult = {
  inviteLink: string;
  token: string;
  expiresAt: string;
};

type AssignableRole = 'STAFF' | 'MANAGER' | 'ACCOUNTANT' | 'HR';

/** Role options offered in the invite selectors (OWNER is never assignable here). */
const INVITE_ROLE_OPTIONS: readonly AssignableRole[] = ['STAFF', 'MANAGER', 'ACCOUNTANT', 'HR'];

/** Map a role value to its i18n label key. */
const ROLE_LABEL_KEY: Record<AssignableRole, string> = {
  STAFF: 'employees.roleStaff',
  MANAGER: 'employees.roleManager',
  ACCOUNTANT: 'employees.roleAccountant',
  HR: 'employees.roleHr',
};

/** One generated invite from `POST /api/companies/:id/invites/bulk`. */
type BulkInviteResult = {
  name: string | null;
  position: string | null;
  role: 'OWNER' | 'MANAGER' | 'ACCOUNTANT' | 'HR' | 'STAFF';
  token: string;
  url: string;
};

type FormState = {
  position: string;
  role: AssignableRole;
  monthlySalary: string;
  hourlyRate: string;
};

const initial: FormState = {
  position: '',
  role: 'STAFF',
  monthlySalary: '',
  hourlyRate: '',
};

type Mode = 'single' | 'bulk';

/** Parse the bulk textarea: one non-empty line = one employee. The first
 *  comma splits "Имя, Должность"; without a comma the whole line is the name. */
function parseBulkLines(text: string): Array<{ name?: string; position?: string }> {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const comma = line.indexOf(',');
      if (comma === -1) return { name: line };
      const name = line.slice(0, comma).trim();
      const position = line.slice(comma + 1).trim();
      return { name: name || undefined, position: position || undefined };
    });
}

export function InviteModal({ companyId, open, onClose, onInvited }: InviteModalProps) {
  const { t } = useLang();
  const [mode, setMode] = React.useState<Mode>('single');

  // --- single-invite state ---
  const [form, setForm] = React.useState<FormState>(initial);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<InviteResult | null>(null);
  const [copied, setCopied] = React.useState(false);

  // --- bulk-invite state ---
  const [bulkText, setBulkText] = React.useState('');
  const [bulkRole, setBulkRole] = React.useState<AssignableRole>('STAFF');
  const [bulkSubmitting, setBulkSubmitting] = React.useState(false);
  const [bulkError, setBulkError] = React.useState<string | null>(null);
  const [bulkResults, setBulkResults] = React.useState<BulkInviteResult[] | null>(null);
  const [copiedIdx, setCopiedIdx] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (!open) {
      setMode('single');
      setForm(initial);
      setSubmitting(false);
      setError(null);
      setResult(null);
      setCopied(false);
      setBulkText('');
      setBulkRole('STAFF');
      setBulkSubmitting(false);
      setBulkError(null);
      setBulkResults(null);
      setCopiedIdx(null);
    }
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      // `userTelegramId: '0'` satisfies a stale `InviteEmployeeDtoSchema.refine`
      // that requires either `phone` or `userTelegramId`, even though the
      // service never reads them — the invite is a one-time deep-link that
      // binds to whoever consumes it. Remove once the backend schema drops
      // the phone/telegramId refinement.
      const payload: Record<string, unknown> = {
        position: form.position || undefined,
        role: form.role,
        userTelegramId: '0',
      };
      if (form.monthlySalary) payload.monthlySalary = Number(form.monthlySalary);
      if (form.hourlyRate) payload.hourlyRate = Number(form.hourlyRate);
      const res = await api.post<InviteResult>(
        `/api/companies/${companyId}/employees/invite`,
        payload,
      );
      setResult(res);
      onInvited?.(res);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Не удалось создать приглашение';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const copyLink = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore
    }
  };

  const submitBulk = async (e: React.FormEvent) => {
    e.preventDefault();
    if (bulkSubmitting) return;
    setBulkError(null);
    const rows = parseBulkLines(bulkText).map((r) => ({ ...r, role: bulkRole }));
    if (rows.length === 0) {
      setBulkError(t('employees.bulk.emptyError'));
      return;
    }
    if (rows.length > 100) {
      setBulkError(t('employees.bulk.tooManyError'));
      return;
    }
    setBulkSubmitting(true);
    try {
      const res = await api.post<BulkInviteResult[]>(
        `/api/companies/${companyId}/invites/bulk`,
        { rows },
      );
      setBulkResults(res);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('employees.bulk.genericError');
      setBulkError(message);
    } finally {
      setBulkSubmitting(false);
    }
  };

  const copyBulkLink = async (idx: number, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx((cur) => (cur === idx ? null : cur)), 1800);
    } catch {
      // ignore
    }
  };

  const tabClass = (active: boolean) =>
    cn(
      'flex-1 h-9 rounded-full border text-[11px] uppercase tracking-[0.18em] transition-colors',
      active
        ? 'bg-[#E98074] text-[#EAE7DC] border-[#E98074]'
        : 'border-[#8E8D8A]/30 text-[#3d3b38] hover:border-[#E98074]/50 hover:text-[#E98074]',
    );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby="invite-title"
    >
      <div className="absolute inset-0 bg-[#8E8D8A]/40 backdrop-blur-sm" onClick={onClose} />
      <Card
        className={cn(
          'relative z-10 w-full max-w-lg !p-0 overflow-hidden flex flex-col max-h-[90vh]',
          'border border-[#8E8D8A]/25 bg-[#EAE7DC]',
        )}
      >
        <div className="flex items-center justify-between px-7 py-5 border-b border-[#8E8D8A]/15">
          <div>
            <div className="text-[10px] uppercase tracking-[0.28em] text-[#6b6966]">
              Приглашение
            </div>
            <h3
              id="invite-title"
              className="mt-1 text-2xl tracking-tight text-[#3d3b38]"
              style={{ fontFamily: 'Fraunces, serif' }}
            >
              Новый сотрудник
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-[#3d3b38] hover:text-[#E85A4F] text-2xl leading-none"
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>

        <div className="px-7 pt-4">
          <div className="flex gap-2">
            <button type="button" onClick={() => setMode('single')} className={tabClass(mode === 'single')}>
              {t('employees.bulk.tabSingle')}
            </button>
            <button type="button" onClick={() => setMode('bulk')} className={tabClass(mode === 'bulk')}>
              {t('employees.bulk.tabBulk')}
            </button>
          </div>
        </div>

        <div className="overflow-y-auto">
          {mode === 'single' ? (
            !result ? (
              <form onSubmit={submit} className="px-7 py-6 flex flex-col gap-4">
                <label className="flex flex-col gap-1.5">
                  <span className="text-[10px] uppercase tracking-[0.24em] text-[#6b6966]">
                    Должность
                  </span>
                  <Input
                    type="text"
                    value={form.position}
                    onChange={(e) => update('position', e.target.value)}
                    placeholder="Например, Бариста"
                  />
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className="text-[10px] uppercase tracking-[0.24em] text-[#6b6966]">Роль</span>
                  <div className="grid grid-cols-2 gap-2">
                    {INVITE_ROLE_OPTIONS.map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => update('role', r)}
                        className={cn(
                          'h-10 rounded-full border text-xs uppercase tracking-[0.22em] transition-colors',
                          form.role === r
                            ? 'bg-[#E98074] text-[#EAE7DC] border-[#E98074]'
                            : 'border-[#8E8D8A]/30 text-[#3d3b38] hover:border-[#E98074]/50 hover:text-[#E98074]',
                        )}
                      >
                        {t(ROLE_LABEL_KEY[r])}
                      </button>
                    ))}
                  </div>
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[10px] uppercase tracking-[0.24em] text-[#6b6966]">
                      Месячный оклад, ₸
                    </span>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={form.monthlySalary}
                      onChange={(e) => update('monthlySalary', e.target.value)}
                      placeholder="300 000"
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[10px] uppercase tracking-[0.24em] text-[#6b6966]">
                      Ставка в час, ₸
                    </span>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={form.hourlyRate}
                      onChange={(e) => update('hourlyRate', e.target.value)}
                      placeholder="2 500"
                    />
                  </label>
                </div>

                {error && <div className="text-xs text-[#E85A4F] tracking-tight">{error}</div>}

                <div className="flex items-center justify-end gap-2 pt-2">
                  <Button variant="ghost" type="button" onClick={onClose}>
                    Отмена
                  </Button>
                  <Button type="submit" variant="primary" disabled={submitting}>
                    {submitting ? 'Создаём…' : 'Создать приглашение'}
                  </Button>
                </div>
              </form>
            ) : (
              <div className="px-7 py-6 flex flex-col gap-5 items-center">
                <div className="rounded-xl border border-[#8E8D8A]/20 p-3 bg-[#EAE7DC]">
                  <QrCode value={result.inviteLink} size={200} fgColor="#8E8D8A" bgColor="#EAE7DC" />
                </div>
                <div
                  className="text-center text-sm text-[#3d3b38] tracking-tight"
                  style={{ fontFamily: 'Fraunces, serif' }}
                >
                  Отсканируйте QR или перешлите ссылку
                </div>
                <div className="w-full flex items-center gap-2">
                  <div className="flex-1 border border-[#8E8D8A]/25 bg-[#D8C3A5]/20 rounded-full px-4 h-10 flex items-center text-sm text-[#3d3b38] truncate">
                    {result.inviteLink}
                  </div>
                  <Button variant={copied ? 'outline' : 'primary'} type="button" onClick={copyLink}>
                    {copied ? 'Скопировано' : 'Копировать'}
                  </Button>
                </div>
                <div className="text-[10px] uppercase tracking-[0.22em] text-[#6b6966]">
                  Действительна до {new Date(result.expiresAt).toLocaleString('ru-RU')}
                </div>
                <div className="flex items-center justify-end w-full pt-2">
                  <Button variant="ghost" type="button" onClick={onClose}>
                    Закрыть
                  </Button>
                </div>
              </div>
            )
          ) : !bulkResults ? (
            <form onSubmit={submitBulk} className="px-7 py-6 flex flex-col gap-4">
              <label className="flex flex-col gap-1.5">
                <span className="text-[10px] uppercase tracking-[0.24em] text-[#6b6966]">
                  {t('employees.bulk.listLabel')}
                </span>
                <textarea
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  rows={7}
                  placeholder={t('employees.bulk.placeholder')}
                  className="w-full rounded-2xl border border-[#8E8D8A]/30 bg-transparent px-4 py-3 text-sm text-[#3d3b38] placeholder:text-[#6b6966]/60 resize-y focus:outline-none focus:border-[#E98074]/60"
                />
                <span className="text-[10px] text-[#6b6966] tracking-tight">
                  {t('employees.bulk.hint')}
                </span>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-[10px] uppercase tracking-[0.24em] text-[#6b6966]">
                  {t('employees.bulk.roleLabel')}
                </span>
                <div className="grid grid-cols-2 gap-2">
                  {INVITE_ROLE_OPTIONS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setBulkRole(r)}
                      className={cn(
                        'h-10 rounded-full border text-xs uppercase tracking-[0.22em] transition-colors',
                        bulkRole === r
                          ? 'bg-[#E98074] text-[#EAE7DC] border-[#E98074]'
                          : 'border-[#8E8D8A]/30 text-[#3d3b38] hover:border-[#E98074]/50 hover:text-[#E98074]',
                      )}
                    >
                      {t(ROLE_LABEL_KEY[r])}
                    </button>
                  ))}
                </div>
              </label>

              {bulkError && (
                <div className="text-xs text-[#E85A4F] tracking-tight">{bulkError}</div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <Button variant="ghost" type="button" onClick={onClose}>
                  Отмена
                </Button>
                <Button type="submit" variant="primary" disabled={bulkSubmitting}>
                  {bulkSubmitting
                    ? t('employees.bulk.generating')
                    : t('employees.bulk.generate')}
                </Button>
              </div>
            </form>
          ) : (
            <div className="px-7 py-6 flex flex-col gap-4">
              <div className="text-[10px] uppercase tracking-[0.22em] text-[#6b6966]">
                {t('employees.bulk.resultCount', { count: bulkResults.length })}
              </div>
              <div className="flex flex-col gap-3">
                {bulkResults.map((row, idx) => (
                  <div
                    key={row.token}
                    className="flex flex-col gap-2 rounded-2xl border border-[#8E8D8A]/20 bg-[#D8C3A5]/15 px-4 py-3"
                  >
                    <div className="text-sm text-[#3d3b38] tracking-tight">
                      {row.name ?? t('employees.bulk.noName')}
                      {row.position ? (
                        <span className="text-[#6b6966]"> — {row.position}</span>
                      ) : null}
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <input
                        readOnly
                        value={row.url}
                        onFocus={(e) => e.currentTarget.select()}
                        className="flex-1 min-w-0 border border-[#8E8D8A]/25 bg-[#EAE7DC] rounded-full px-4 h-9 text-xs text-[#3d3b38] truncate focus:outline-none"
                      />
                      <Button
                        variant={copiedIdx === idx ? 'outline' : 'primary'}
                        type="button"
                        onClick={() => copyBulkLink(idx, row.url)}
                        className="shrink-0"
                      >
                        {copiedIdx === idx
                          ? t('employees.bulk.copied')
                          : t('employees.bulk.copy')}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between pt-2">
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => {
                    setBulkResults(null);
                    setBulkText('');
                    setBulkError(null);
                  }}
                >
                  {t('employees.bulk.again')}
                </Button>
                <Button variant="ghost" type="button" onClick={onClose}>
                  Закрыть
                </Button>
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

export default InviteModal;
