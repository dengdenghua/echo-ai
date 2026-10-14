import { useEffect } from "react";

import {
  pageTranslation,
  pageTranslationSupported,
} from "@/core/browser/page-translation";
import { useI18n } from "@/core/i18n/hooks";

import { requestBrowserAssistantAsk } from "./assistant-ask";

type SelectionAction = "explain" | "translate" | "ask";

interface SelectionRequest {
  text: string;
  action: SelectionAction;
  /** The tab the selection is in (sent by the desktop shell). */
  webContentsId: number | null;
}

/** The context-menu payload from the main process, checked field by field. */
export function parseSelectionRequest(value: unknown): SelectionRequest | null {
  if (typeof value !== "object" || value === null) return null;
  const text =
    "text" in value && typeof value.text === "string" ? value.text.trim() : "";
  if (!text) return null;
  const raw = "action" in value ? value.action : undefined;
  const action: SelectionAction =
    raw === "translate" || raw === "ask" ? raw : "explain";
  const webContentsId =
    "webContentsId" in value && typeof value.webContentsId === "number"
      ? value.webContentsId
      : null;
  return { text, action, webContentsId };
}

/**
 * Right-click on selected text in a page (desktop app): a translation shows
 * in a card under the selection; explaining it or asking about it goes to
 * the assistant.
 */
export function useSelectionActions(openAssistant: (open: boolean) => void) {
  const { t, locale } = useI18n();
  useEffect(() => {
    if (!window.echo) return;
    const off = window.echo.on("browser:ask-selection", (...args) => {
      const request = parseSelectionRequest(args[0]);
      if (!request) return;
      const quote = request.text;
      if (
        request.action === "translate" &&
        request.webContentsId !== null &&
        pageTranslationSupported()
      ) {
        const tr = t.browser.pageTranslate;
        pageTranslation.translateSelection(
          request.webContentsId,
          quote,
          locale,
          {
            title: tr.selectionTitle,
            copy: tr.copy,
            copied: tr.copied,
            close: tr.close,
            translating: tr.translating,
            failed: tr.selectionFailed,
          },
        );
        return;
      }
      openAssistant(true);
      if (request.action === "ask") {
        requestBrowserAssistantAsk(`关于这段内容：\n「${quote}」\n`, "draft");
      } else if (request.action === "translate") {
        requestBrowserAssistantAsk(`把这段翻译成中文：\n「${quote}」`);
      } else {
        requestBrowserAssistantAsk(`解释这段内容：\n「${quote}」`);
      }
    });
    return () => off();
  }, [locale, openAssistant, t]);
}
