import { LanguagesIcon, Loader2Icon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import {
  isAlwaysTranslated,
  pageTranslation,
  pageTranslationSupported,
  setAlwaysTranslated,
  siteOrigin,
  usePageTranslation,
} from "@/core/browser/page-translation";
import type { PageLanguageGuess } from "@/core/browser/page-translator";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

type View = "translated" | "bilingual" | "original";

interface Props {
  tabId: string;
  url: string;
  isLoading: boolean;
  webContentsId: number | null;
}

/**
 * Address-bar translate button (desktop app). It appears when the page is
 * not in the reader's language, or while the tab is translating.
 */
export function PageTranslateButton({
  tabId,
  url,
  isLoading,
  webContentsId,
}: Props) {
  const { t, locale } = useI18n();
  const tr = t.browser.pageTranslate;
  const state = usePageTranslation(tabId);
  const [open, setOpen] = useState(false);
  const [always, setAlways] = useState(() => isAlwaysTranslated(url));
  const rootRef = useRef<HTMLDivElement>(null);
  const supported = pageTranslationSupported() && siteOrigin(url) !== null;

  // Check every page once it has loaded, and again when its tab comes forward.
  useEffect(() => {
    if (!supported || isLoading || webContentsId === null) return;
    pageTranslation.pageLoaded(tabId, webContentsId, url, locale);
  }, [supported, isLoading, webContentsId, tabId, url, locale]);

  useEffect(() => {
    setAlways(isAlwaysTranslated(url));
    setOpen(false);
  }, [url, tabId]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!supported) return null;
  if (!state.language?.foreign && !state.active) return null;

  const view: View = state.active ? state.mode : "original";
  const choose = (next: View) => {
    if (next === "original") {
      pageTranslation.showOriginal(tabId);
    } else if (webContentsId !== null) {
      pageTranslation.translate(tabId, webContentsId, next, locale);
    }
  };
  const toggleAlways = (on: boolean) => {
    setAlways(on);
    setAlwaysTranslated(url, on);
    if (on && !state.active && webContentsId !== null) {
      pageTranslation.translate(tabId, webContentsId, state.mode, locale);
    }
  };
  const failed = state.progress?.failed ?? 0;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        title={tr.button}
        aria-label={tr.button}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          // The first click translates; after that it opens the options.
          if (!state.active && !open && webContentsId !== null) {
            pageTranslation.translate(tabId, webContentsId, state.mode, locale);
          }
          setOpen((value) => !value);
        }}
        className={cn(
          "grid size-7 place-items-center rounded-md transition-colors",
          state.active
            ? "text-core hover:bg-foreground/5"
            : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
          open && "bg-foreground/5",
        )}
      >
        {state.busy ? (
          <Loader2Icon className="size-3.5 animate-spin" />
        ) : (
          <LanguagesIcon className="size-3.5" />
        )}
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label={tr.title}
          className="absolute right-0 top-full z-50 mt-2 w-[300px] max-w-[calc(100vw-1rem)] rounded-xl bg-popover p-3 text-popover-foreground shadow-lg"
        >
          <div className="text-sm font-semibold">{tr.title}</div>
          {state.language ? (
            <div className="mt-0.5 text-xs text-muted-foreground">
              {tr.detected(languageName(state.language, tr.languages))}
            </div>
          ) : null}
          <SegmentedControl<View>
            className="mt-3"
            size="sm"
            fullWidth
            aria-label={tr.title}
            value={view}
            onChange={choose}
            options={[
              { value: "translated", label: tr.translated },
              { value: "bilingual", label: tr.bilingual },
              { value: "original", label: tr.original },
            ]}
          />
          <div className="mt-2 min-h-5 text-xs" aria-live="polite">
            {state.error ? (
              <span className="flex items-center justify-between gap-2 text-destructive">
                <span>{state.error}</span>
                <button
                  type="button"
                  onClick={() => pageTranslation.retry(tabId)}
                  className="shrink-0 rounded-md border border-border-default px-2 py-0.5 text-foreground hover:bg-muted"
                >
                  {tr.retry}
                </button>
              </span>
            ) : state.busy ? (
              <span className="text-muted-foreground">{tr.translating}</span>
            ) : failed > 0 ? (
              <span className="text-muted-foreground">
                {tr.skipped(failed)}
              </span>
            ) : null}
          </div>
          <label className="mt-2 flex cursor-pointer items-center justify-between gap-3 text-xs">
            <span>{tr.alwaysSite}</span>
            <Switch checked={always} onCheckedChange={toggleAlways} />
          </label>
          <p className="mt-3 text-micro leading-4 text-muted-foreground">
            {tr.privacy}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function languageName(
  guess: PageLanguageGuess,
  names: Record<string, string>,
): string {
  const declared = guess.declared.split("-")[0] ?? "";
  if (guess.lang === "latin" && names[declared]) return names[declared];
  return names[guess.lang] ?? names.unknown ?? guess.lang;
}
