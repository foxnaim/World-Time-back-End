'use client';

import * as React from 'react';
import { DEFAULT_LOCALE, LOCALE_COOKIE, type Locale } from './config';
import { createTranslator, type Translator } from './translator';
import type { Messages } from './messages';
import ruMessages from './messages/ru.json';
import enMessages from './messages/en.json';
import kzMessages from './messages/kz.json';

const ALL_MESSAGES: Record<Locale, Messages> = {
  ru: ruMessages as Messages,
  en: enMessages as Messages,
  kz: kzMessages as Messages,
};

interface LangContextValue {
  locale: Locale;
  t: Translator;
  setLocale: (locale: Locale) => void;
}

const LangContext = React.createContext<LangContextValue>({
  locale: DEFAULT_LOCALE,
  t: createTranslator(ruMessages as Messages),
  setLocale: () => {},
});

export function LangProvider({
  children,
  initialLocale = DEFAULT_LOCALE,
}: {
  children: React.ReactNode;
  initialLocale?: Locale;
}) {
  const [locale, setLocaleState] = React.useState<Locale>(initialLocale);

  // Keep local state in sync with the server-resolved locale. When the
  // cookie changes on the client and router.refresh() re-renders the tree,
  // the RSC above pushes a new `initialLocale` down — we adopt it here.
  React.useEffect(() => {
    if (initialLocale !== locale) setLocaleState(initialLocale);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLocale]);

  const setLocale = React.useCallback((l: Locale) => {
    setLocaleState(l);
    if (typeof document !== 'undefined') {
      document.cookie = `${LOCALE_COOKIE}=${l};path=/;max-age=${60 * 60 * 24 * 365};SameSite=Lax`;
    }
  }, []);

  const t = React.useMemo(() => createTranslator(ALL_MESSAGES[locale]), [locale]);

  return (
    <LangContext.Provider value={{ locale, t, setLocale }}>
      {children}
    </LangContext.Provider>
  );
}

export function useLang(): LangContextValue {
  return React.useContext(LangContext);
}
