import { useEffect, useState } from "react";

import { useI18nContext } from "./context";

import type { Locale } from "./index";

export function useI18n() {
  const { locale, setLocale, t } = useI18nContext();
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  const changeLocale = (newLocale: Locale) => {
    // The provider only commits after the bundle loads. Keep a failed chunk
    // out of the unhandled-rejection path; the current locale stays intact.
    void setLocale(newLocale).catch(() => {});
  };

  return {
    locale,
    t,
    changeLocale,
    isClient,
  };
}
