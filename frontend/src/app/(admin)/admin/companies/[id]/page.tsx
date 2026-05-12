'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import useSWR, { useSWRConfig } from 'swr';
import { fetcher } from '@/lib/fetcher';
import { api, ApiError } from '@/lib/api';

type CompanyDetail = {
  id: string;
  name: string;
  slug: string;
  address?: string | null;
  timezone: string;
  workStartHour: number;
  workEndHour: number;
  createdAt: string;
  owner: {
    id: string;
    telegramId: string;
    firstName: string;
    lastName?: string | null;
    username?: string | null;
    phone?: string | null;
  };
  _count: {
    employees: number;
    qrTokens: number;
    inviteTokens: number;
  };
  employees: Array<{
    id: string;
    role: 'OWNER' | 'MANAGER' | 'ACCOUNTANT' | 'HR' | 'STAFF';
    status: 'ACTIVE' | 'INACTIVE';
    position: string | null;
    createdAt: string;
    user: {
      id: string;
      telegramId: string;
      firstName: string;
      lastName?: string | null;
      username?: string | null;
    };
  }>;
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

function ConfirmModal({
  open,
  onClose,
  onConfirm,
  busy,
  companyName,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  busy: boolean;
  companyName: string;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-40 bg-stone-900/40 flex items-center justify-center px-4"
      onClick={busy ? undefined : onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-stone-100 border border-stone-300/70 p-6"
      >
        <div className="text-[10px] uppercase tracking-[0.28em] text-stone-500">Подтверждение</div>
        <h2
          className="mt-2 text-2xl text-stone-800 tracking-tight"
          style={{ fontFamily: 'Fraunces, serif' }}
        >
          Деактивировать компанию?
        </h2>
        <p className="mt-3 text-sm text-stone-600">
          Все активные сотрудники <b>{companyName}</b> будут переведены в статус INACTIVE. Действие
          необратимо через UI — для восстановления потребуется ручное вмешательство.
        </p>
        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            disabled={busy}
            className="h-9 px-4 text-xs uppercase tracking-[0.22em] text-stone-600 hover:text-stone-900 disabled:opacity-40"
          >
            Отмена
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="h-9 px-4 text-xs uppercase tracking-[0.22em] bg-red-700 text-stone-50 hover:bg-red-800 disabled:opacity-40"
          >
            {busy ? 'Выполняется…' : 'Деактивировать'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-stone-200 last:border-b-0">
      <div className="text-[10px] uppercase tracking-[0.22em] text-stone-500">{label}</div>
      <div className="text-sm text-stone-800 text-right break-all">{value}</div>
    </div>
  );
}

export default function AdminCompanyDetailsPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const router = useRouter();
  const { mutate } = useSWRConfig();

  const { data, error, isLoading } = useSWR<CompanyDetail>(
    id ? `/admin/companies/${id}` : null,
    fetcher,
    { revalidateOnFocus: false },
  );

  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [flash, setFlash] = React.useState<string | null>(null);

  async function onDeactivate() {
    if (!id) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await api.post<{
        companyId: string;
        deactivatedEmployees: number;
      }>(`/admin/companies/${id}/deactivate`);
      setFlash(`Деактивировано сотрудников: ${res.deactivatedEmployees}.`);
      setConfirmOpen(false);
      // Refresh detail + list.
      await mutate(`/admin/companies/${id}`);
      await mutate(
        (k) => Array.isArray(k) && typeof k[0] === 'string' && k[0] === '/admin/companies',
      );
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Не удалось деактивировать';
      setErr(msg);
    } finally {
      setBusy(false);
    }
  }

  if (isLoading) {
    return <div className="text-xs uppercase tracking-[0.22em] text-stone-500">Загрузка…</div>;
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        <div className="text-sm text-red-600">Не удалось загрузить компанию.</div>
        <Link
          href="/admin/companies"
          className="text-xs uppercase tracking-[0.22em] text-stone-500 hover:text-stone-900"
        >
          ← К списку
        </Link>
      </div>
    );
  }

  const ownerName = [data.owner.firstName, data.owner.lastName].filter(Boolean).join(' ');

  return (
    <div className="flex flex-col gap-8">
      <div>
        <button
          onClick={() => router.push('/admin/companies')}
          className="text-xs uppercase tracking-[0.22em] text-stone-500 hover:text-stone-900"
        >
          ← К списку
        </button>
        <div className="mt-4 flex items-end justify-between gap-6 flex-wrap">
          <div>
            <div className="text-[10px] uppercase tracking-[0.3em] text-stone-500">Компания</div>
            <h1
              className="mt-2 text-4xl md:text-5xl text-stone-800 tracking-tight"
              style={{ fontFamily: 'Fraunces, serif', fontWeight: 400 }}
            >
              {data.name}
            </h1>
            <div className="mt-1 text-xs font-mono text-stone-500">
              /{data.slug} · id: {data.id}
            </div>
          </div>
          <button
            onClick={() => setConfirmOpen(true)}
            className="h-10 px-4 text-xs uppercase tracking-[0.22em] border border-red-700 text-red-700 hover:bg-red-700 hover:text-stone-50 transition-colors"
          >
            Деактивировать
          </button>
        </div>
      </div>

      {flash && (
        <div className="border border-stone-300/70 bg-stone-100 px-4 py-3 text-sm text-stone-700">
          {flash}
        </div>
      )}
      {err && (
        <div className="border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="border border-stone-300/70 bg-stone-100 p-6">
          <div className="text-[10px] uppercase tracking-[0.28em] text-stone-500">Параметры</div>
          <div className="mt-4">
            <Row label="Адрес" value={data.address || '—'} />
            <Row label="Часовой пояс" value={data.timezone} />
            <Row label="Рабочие часы" value={`${data.workStartHour}:00 – ${data.workEndHour}:00`} />
            <Row label="Создана" value={formatDate(data.createdAt)} />
            <Row label="Сотрудников" value={data._count.employees} />
            <Row label="QR-токенов" value={data._count.qrTokens} />
            <Row label="Приглашений" value={data._count.inviteTokens} />
          </div>
        </section>

        <section className="border border-stone-300/70 bg-stone-100 p-6">
          <div className="text-[10px] uppercase tracking-[0.28em] text-stone-500">Владелец</div>
          <div className="mt-4">
            <Row label="Имя" value={ownerName || '—'} />
            <Row label="Username" value={data.owner.username ? `@${data.owner.username}` : '—'} />
            <Row label="Telegram ID" value={data.owner.telegramId} />
            <Row label="Телефон" value={data.owner.phone || '—'} />
          </div>
        </section>
      </div>

      <section>
        <div className="text-[10px] uppercase tracking-[0.28em] text-stone-500 mb-3">
          Сотрудники ({data.employees.length})
        </div>
        <div className="border border-stone-300/70 bg-stone-100">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-stone-300/70">
                <th className="px-4 py-3 text-[10px] uppercase tracking-[0.22em] text-stone-500 font-normal">
                  Имя
                </th>
                <th className="px-4 py-3 text-[10px] uppercase tracking-[0.22em] text-stone-500 font-normal">
                  Роль
                </th>
                <th className="px-4 py-3 text-[10px] uppercase tracking-[0.22em] text-stone-500 font-normal">
                  Статус
                </th>
                <th className="px-4 py-3 text-[10px] uppercase tracking-[0.22em] text-stone-500 font-normal">
                  Должность
                </th>
                <th className="px-4 py-3 text-[10px] uppercase tracking-[0.22em] text-stone-500 font-normal">
                  Telegram
                </th>
              </tr>
            </thead>
            <tbody>
              {data.employees.map((e) => {
                const name = [e.user.firstName, e.user.lastName].filter(Boolean).join(' ') || '—';
                return (
                  <tr key={e.id} className="border-b border-stone-200 last:border-b-0">
                    <td className="px-4 py-2 text-stone-800">{name}</td>
                    <td className="px-4 py-2 text-stone-600 font-mono text-xs">{e.role}</td>
                    <td
                      className={
                        'px-4 py-2 font-mono text-xs ' +
                        (e.status === 'ACTIVE' ? 'text-green-700' : 'text-stone-400')
                      }
                    >
                      {e.status}
                    </td>
                    <td className="px-4 py-2 text-stone-600">{e.position || '—'}</td>
                    <td className="px-4 py-2 text-stone-500 font-mono text-xs">
                      {e.user.username ? `@${e.user.username}` : e.user.telegramId}
                    </td>
                  </tr>
                );
              })}
              {data.employees.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-8 text-center text-stone-500 text-xs uppercase tracking-[0.22em]"
                  >
                    Нет сотрудников
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <ConfirmModal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={onDeactivate}
        busy={busy}
        companyName={data.name}
      />
    </div>
  );
}
