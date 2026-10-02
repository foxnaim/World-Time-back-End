'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { Button } from '@tact/ui';
import { CodeInput } from '@/components/ui/code-input';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/use-toast';
import { TelegramLogin, type TelegramUser } from '@/components/shared/telegram-login';
import { api } from '@/lib/api';
import { setAuthCookies } from '@/lib/auth-cookie';

interface LoginViewProps {
  heading?: string;
  subtitle?: string;
  submitLabel?: string;
  /** Override where we go after successful auth (default: ?next or /dashboard). */
  redirectTo?: string;
}

interface BotLoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn?: number;
  user?: { id: string; telegramId?: string };
}

export default function LoginPage() {
  return (
    <LoginView
      heading="Войти"
      subtitle={`Открой бота @${process.env.NEXT_PUBLIC_BOT_USERNAME ?? 'worktact_bot'} → нажми «Войти» → скопируй код`}
      submitLabel="Войти"
    />
  );
}

/**
 * Reusable login view. Imported by /register to avoid copy-paste.
 */
export function LoginView({
  heading = 'Войти',
  subtitle = `Открой бота @${process.env.NEXT_PUBLIC_BOT_USERNAME ?? 'worktact_bot'} → нажми «Войти» → скопируй код`,
  submitLabel = 'Войти',
  redirectTo,
}: LoginViewProps) {
  const router = useRouter();
  const search = useSearchParams();
  const next = redirectTo ?? search.get('next') ?? '/dashboard';
  const toast = useToast();

  const [code, setCode] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [tgOpen, setTgOpen] = React.useState(false);

  const onSubmit = React.useCallback(
    async (codeValue?: string) => {
      const value = (codeValue ?? code).trim();
      if (value.length !== 6) {
        setError('Введите 6-значный код из бота');
        return;
      }
      setSubmitting(true);
      setError(null);
      try {
        const res = await api.post<BotLoginResponse>('/auth/telegram/bot-login', {
          oneTimeCode: value,
        });
        setAuthCookies({
          accessToken: res.accessToken,
          refreshToken: res.refreshToken,
          expiresIn: res.expiresIn,
        });
        toast.success('Вход выполнен');
        router.push(next);
        router.refresh();
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Не удалось войти. Проверьте код.';
        setError(msg);
        toast.error('Неверный код', { description: msg });
        setCode('');
      } finally {
        setSubmitting(false);
      }
    },
    [code, next, router, toast],
  );

  const onWidgetAuth = React.useCallback(
    async (user: TelegramUser) => {
      setSubmitting(true);
      try {
        const res = await api.post<BotLoginResponse>('/auth/telegram/verify', {
          initData: user,
        });
        setAuthCookies({
          accessToken: res.accessToken,
          refreshToken: res.refreshToken,
          expiresIn: res.expiresIn,
        });
        toast.success('Вход через Telegram выполнен');
        setTgOpen(false);
        router.push(next);
        router.refresh();
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Не удалось подтвердить Telegram';
        toast.error('Ошибка Telegram', { description: msg });
      } finally {
        setSubmitting(false);
      }
    },
    [next, router, toast],
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
      className="w-full max-w-md"
    >
      <div className="relative bg-cream/80 backdrop-blur-sm rounded-2xl border border-stone/20 shadow-[0_1px_0_rgba(142,141,138,0.08)] p-8 md:p-10">
        <div className="text-center mb-8">
          <p className="text-[10px] uppercase tracking-[0.28em] text-[#6b6966] mb-3">
            Work Tact · Авторизация
          </p>
          <h1
            className="text-4xl md:text-5xl font-medium tracking-tight text-[#3d3b38]"
            style={{ fontFamily: 'Fraunces, serif' }}
          >
            {heading}
          </h1>
          <p className="mt-3 text-sm text-[#6b6966] leading-relaxed">
            {subtitle.split('→').map((chunk, i, arr) => (
              <React.Fragment key={i}>
                {chunk.trim()}
                {i < arr.length - 1 && <span className="mx-2 text-coral">→</span>}
              </React.Fragment>
            ))}
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
          className="space-y-6"
        >
          <div className="flex flex-col items-center gap-3">
            <label
              htmlFor="otp-0"
              className="text-[10px] uppercase tracking-[0.22em] text-[#6b6966]"
            >
              Одноразовый код
            </label>
            <CodeInput
              value={code}
              onChange={setCode}
              onComplete={(v) => {
                // auto-submit on complete for frictionless UX
                if (!submitting) void onSubmit(v);
              }}
              autoFocus
              disabled={submitting}
              error={!!error}
            />
            {error && (
              <p className="text-xs text-red text-center" role="alert">
                {error}
              </p>
            )}
          </div>

          <Button
            type="submit"
            variant="primary"
            size="lg"
            className="w-full"
            disabled={submitting || code.length !== 6}
          >
            {submitting ? 'Проверяем…' : submitLabel}
          </Button>
        </form>

        <div className="mt-6 pt-6 border-t border-stone/20 flex flex-col items-center gap-2">
          <Link
            href="/"
            className="text-[11px] uppercase tracking-[0.22em] text-stone/40 hover:text-[#6b6966] transition-colors"
          >
            ← На главную
          </Link>
        </div>
      </div>

      <Modal
        open={tgOpen}
        onClose={() => setTgOpen(false)}
        title="Telegram Login"
        description="Подтвердите вход через официальный виджет Telegram."
      >
        <div className="flex flex-col items-center gap-4 py-2">
          <TelegramLogin onAuth={onWidgetAuth} size="large" cornerRadius={12} lang="ru" />
          <p className="text-[10px] uppercase tracking-[0.22em] text-stone/50 text-center">
            Если виджет не появился — проверьте, что у бота включён
            <span className="mx-1 text-coral">domain</span>в BotFather.
          </p>
        </div>
      </Modal>
    </motion.div>
  );
}
