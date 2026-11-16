import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { Locale } from "@/core/i18n";
import { setLocaleInCookie } from "@/core/i18n/cookies";
import type { Translations } from "@/core/i18n/locales";
import { loadTranslations, primeTranslations } from "@/core/i18n/translations";

export interface I18nContextType {
  locale: Locale;
  t: Translations;
  setLocale: (locale: Locale) => Promise<void>;
}

export const I18nContext = createContext<I18nContextType | null>(null);

export function I18nProvider({
  children,
  initialLocale,
  initialTranslations,
  loadLocale = loadTranslations,
}: {
  children: ReactNode;
  initialLocale: Locale;
  initialTranslations: Translations;
  loadLocale?: (locale: Locale) => Promise<Translations>;
}) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const [t, setTranslations] = useState<Translations>(initialTranslations);
  const requestSeqRef = useRef(0);

  primeTranslations(initialLocale, initialTranslations);

  const handleSetLocale = useCallback(
    async (newLocale: Locale) => {
      const requestId = ++requestSeqRef.current;
      // Commit locale, cookie and document language together, only after the
      // bundle is available. A failed chunk load must leave the current
      // language fully coherent instead of mixing chrome and copy.
      const nextTranslations = await loadLocale(newLocale);
      if (requestId !== requestSeqRef.current) {
        return;
      }
      setLocale(newLocale);
      setTranslations(nextTranslations);
      setLocaleInCookie(newLocale);
      document.documentElement.lang = newLocale.split("-")[0] ?? newLocale;
    },
    [loadLocale],
  );

  const value = useMemo<I18nContextType>(
    () => ({ locale, t, setLocale: handleSetLocale }),
    [locale, t, handleSetLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18nContext() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within I18nProvider");
  }
  return context;
}
