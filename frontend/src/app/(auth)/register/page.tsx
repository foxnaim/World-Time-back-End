'use client';

import * as React from 'react';
import { LoginView } from '../login/page';

/**
 * Registration entry point for B2B owners. The flow is:
 *   1. Authenticate via Telegram (same mechanism as /login — reused below).
 *   2. On success we redirect to /onboarding/company where the multi-step
 *      form collects company data.
 *
 * Copy is tweaked so users understand this initial step creates their
 * account; the actual company creation happens in onboarding.
 */
export default function RegisterPage() {
  return (
    <LoginView
      heading="Зарегистрироваться"
      subtitle={`Открой бота @${process.env.NEXT_PUBLIC_BOT_USERNAME ?? 'worktact_bot'} → нажми «Войти» → введи код здесь`}
      submitLabel="Войти через Telegram"
      redirectTo="/dashboard"
    />
  );
}
