import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider, useI18nContext } from "./context";
import { getLocaleFromCookie } from "./cookies";
import { jaJP, zhCN } from "./locales";

describe("I18nProvider locale transaction", () => {
  beforeEach(() => {
    document.cookie = "locale=; max-age=0; path=/";
    document.documentElement.lang = "zh-CN";
  });

  afterEach(() => {
    document.cookie = "locale=; max-age=0; path=/";
  });

  it("keeps locale, cookie and document language unchanged when loading fails", async () => {
    const loadLocale = vi.fn().mockRejectedValue(new Error("chunk failed"));
    const { result } = renderHook(() => useI18nContext(), {
      wrapper: ({ children }) => (
        <I18nProvider
          initialLocale="zh-CN"
          initialTranslations={zhCN}
          loadLocale={loadLocale}
        >
          {children}
        </I18nProvider>
      ),
    });

    await act(async () => {
      await expect(result.current.setLocale("ja-JP")).rejects.toThrow(
        "chunk failed",
      );
    });

    expect(result.current.locale).toBe("zh-CN");
    expect(result.current.t).toBe(zhCN);
    expect(getLocaleFromCookie()).toBeNull();
    expect(document.documentElement.lang).toBe("zh-CN");
  });

  it("commits locale, cookie and document language together on success", async () => {
    const { result } = renderHook(() => useI18nContext(), {
      wrapper: ({ children }) => (
        <I18nProvider
          initialLocale="zh-CN"
          initialTranslations={zhCN}
          loadLocale={async () => jaJP}
        >
          {children}
        </I18nProvider>
      ),
    });

    await act(async () => {
      await result.current.setLocale("ja-JP");
    });

    expect(result.current.locale).toBe("ja-JP");
    expect(result.current.t).toBe(jaJP);
    expect(getLocaleFromCookie()).toBe("ja-JP");
    expect(document.documentElement.lang).toBe("ja");
  });
});
