import { useSyncExternalStore } from "react";

import { EchoAPIError } from "@/core/api/client";
import { apiPost } from "@/core/api/request";

import {
  PAGE_TRANSLATOR_MISSING,
  pageTranslatorCall,
  pageTranslatorInstall,
  type PageLanguageGuess,
  type PageTranslationMode,
  type PageTranslationResult,
  type PageTranslationSegment,
  type PageTranslationTarget,
  type PageTranslatorPump,
  type PageTranslatorStatus,
} from "./page-translator";

/**
 * Per-tab controller for in-page translation (desktop app).
 *
 * The page side (`page-translator.ts`) lives in the tab's isolated world and
 * hands out the paragraphs that are on or near the screen; this side sends
 * them to `/api/browser/translate` and writes the answers back. A session
 * keeps running while its tab is in the background and stays on across
 * navigations in that tab, picking up every new page that is not Chinese,
 * until the user switches back to the original.
 */

export interface PageTranslationState {
  /** Guess for the page on screen; null until the page was checked. */
  language: PageLanguageGuess | null;
  /** Translation stays on for this tab until the user turns it off. */
  active: boolean;
  mode: Exclude<PageTranslationMode, "original">;
  progress: PageTranslatorStatus | null;
  /** A request is out. */
  busy: boolean;
  error: string | null;
}

const BATCH_SEGMENTS = 20;
const BATCH_CHARS = 3000;
const MAX_PARALLEL = 2;
const PUMP_BUSY_MS = 400;
const PUMP_IDLE_MS = 1500;
const ALWAYS_KEY = "echo.browser.translate.alwaysSites";

const IDLE: PageTranslationState = {
  language: null,
  active: false,
  mode: "translated",
  progress: null,
  busy: false,
  error: null,
};

type Exec = (webContentsId: number, code: string) => Promise<unknown>;

function isolatedExec(): Exec | null {
  if (typeof window === "undefined") return null;
  return window.echo?.browser?.executeIsolated ?? null;
}

export function pageTranslationSupported(): boolean {
  return isolatedExec() !== null;
}

function readAlwaysSites(): string[] {
  try {
    const raw = localStorage.getItem(ALWAYS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export function siteOrigin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.origin
      : null;
  } catch {
    return null;
  }
}

export function isAlwaysTranslated(url: string | undefined): boolean {
  const origin = siteOrigin(url);
  return origin !== null && readAlwaysSites().includes(origin);
}

export function setAlwaysTranslated(url: string | undefined, on: boolean) {
  const origin = siteOrigin(url);
  if (!origin) return;
  const sites = readAlwaysSites().filter((site) => site !== origin);
  if (on) sites.push(origin);
  try {
    localStorage.setItem(ALWAYS_KEY, JSON.stringify(sites.slice(-500)));
  } catch {
    // Browser storage is a convenience; the choice just is not remembered.
  }
  emit();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStatus(value: unknown): value is PageTranslatorStatus {
  return (
    isRecord(value) &&
    typeof value.doc === "string" &&
    typeof value.segments === "number" &&
    typeof value.done === "number"
  );
}

function isLanguage(value: unknown): value is PageLanguageGuess {
  return (
    isRecord(value) &&
    typeof value.lang === "string" &&
    typeof value.foreign === "boolean"
  );
}

function isPump(value: unknown): value is PageTranslatorPump {
  return (
    isRecord(value) &&
    isStatus(value.status) &&
    isLanguage(value.language) &&
    Array.isArray(value.batch)
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof EchoAPIError || error instanceof Error) {
    return error.message;
  }
  return String(error);
}

class TabTranslation {
  state: PageTranslationState = IDLE;
  private webContentsId: number | null = null;
  private target: PageTranslationTarget = "zh-CN";
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = 0;
  private pumping = false;
  private again = false;
  private failures = 0;
  private closed = false;

  constructor(private readonly exec: Exec) {}

  private update(patch: Partial<PageTranslationState>) {
    this.state = { ...this.state, ...patch };
    emit();
  }

  /** Runs `call` against the page's translator (installing it on a new
   * document) and checks the shape of what the other world sent back. */
  private async call<T>(
    call: string,
    is: (value: unknown) => value is T,
  ): Promise<T | null> {
    if (this.webContentsId === null) return null;
    const id = this.webContentsId;
    let result = await this.exec(id, pageTranslatorCall(call));
    if (result === PAGE_TRANSLATOR_MISSING) {
      result = await this.exec(id, pageTranslatorInstall(call));
    }
    return is(result) ? result : null;
  }

  /** The page in this tab finished loading (or the tab came forward). */
  async pageLoaded(
    webContentsId: number,
    url: string,
    target: PageTranslationTarget,
  ) {
    this.webContentsId = webContentsId;
    this.target = target;
    try {
      const language = await this.call(
        `detect(${JSON.stringify(target)})`,
        isLanguage,
      );
      this.update({ language });
      if (!this.state.active && language?.foreign && isAlwaysTranslated(url)) {
        this.update({ active: true, error: null });
      }
      if (this.state.active) this.schedule(0);
    } catch {
      // The tab went away or the page refused scripts; nothing to offer.
    }
  }

  async translate(
    webContentsId: number,
    mode: PageTranslationState["mode"],
    target: PageTranslationTarget,
  ) {
    this.webContentsId = webContentsId;
    this.target = target;
    this.update({ active: true, mode, error: null });
    try {
      const progress = await this.call(
        `start(${JSON.stringify(mode)}, ${JSON.stringify(target)})`,
        isStatus,
      );
      this.update({ progress });
    } catch (error) {
      this.update({ error: errorMessage(error) });
    }
    this.schedule(0);
  }

  async showOriginal() {
    this.stop();
    this.update({ active: false, error: null });
    try {
      const progress = await this.call('setMode("original")', isStatus);
      if (progress) this.update({ progress });
    } catch {
      // Already gone.
    }
  }

  close() {
    this.closed = true;
    this.stop();
  }

  private stop() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(delay: number) {
    if (this.closed || !this.state.active) return;
    this.stop();
    this.timer = setTimeout(() => void this.pump(), delay);
  }

  private async pump() {
    this.timer = null;
    if (!this.state.active || this.closed) return;
    if (this.pumping) {
      this.again = true;
      return;
    }
    this.pumping = true;
    try {
      await this.pumpOnce();
    } finally {
      this.pumping = false;
      if (this.again) {
        this.again = false;
        this.schedule(0);
      }
    }
  }

  private async pumpOnce() {
    let tick: PageTranslatorPump | null = null;
    try {
      tick = await this.call(
        `pump(${JSON.stringify(this.state.mode)}, ${JSON.stringify(this.target)}, ${BATCH_SEGMENTS}, ${BATCH_CHARS})`,
        isPump,
      );
      this.failures = 0;
    } catch {
      // Navigating, or the tab is gone: after a few misses in a row stop
      // polling a tab that no longer exists.
      this.failures += 1;
      if (this.failures >= 5) this.close();
      else this.schedule(PUMP_IDLE_MS);
      return;
    }
    if (!tick) return;
    this.update({ language: tick.language, progress: tick.status });
    if (tick.batch.length > 0) {
      this.running += 1;
      this.update({ busy: true });
      void this.send(tick.status.doc, tick.batch).finally(() => {
        this.running -= 1;
        this.update({ busy: this.running > 0 });
        if (this.state.error === null) this.schedule(0);
      });
      if (this.running < MAX_PARALLEL) this.schedule(0);
      return;
    }
    this.schedule(this.running > 0 ? PUMP_BUSY_MS : PUMP_IDLE_MS);
  }

  private async send(doc: string, batch: PageTranslationSegment[]) {
    try {
      const response = await apiPost("/api/browser/translate", {
        body: { target: this.target, segments: batch },
      });
      const translations: PageTranslationResult[] = response.translations;
      const answered = new Set(translations.map((item) => item.id));
      const missing = batch
        .map((item) => item.id)
        .filter((id) => !answered.has(id));
      let progress = await this.call(
        `apply(${JSON.stringify(doc)}, ${JSON.stringify(translations)})`,
        isStatus,
      );
      if (missing.length > 0) {
        progress = await this.call(
          `fail(${JSON.stringify(doc)}, ${JSON.stringify(missing)})`,
          isStatus,
        );
      }
      if (progress) this.update({ progress });
    } catch (error) {
      await this.call(
        `fail(${JSON.stringify(doc)}, ${JSON.stringify(batch.map((item) => item.id))})`,
        isStatus,
      ).catch(() => undefined);
      // Stop on a failure instead of hammering the service; the user
      // retries from the translate menu.
      this.stop();
      this.update({ error: errorMessage(error) });
    }
  }

  retry() {
    if (!this.state.active) return;
    this.update({ error: null });
    this.schedule(0);
  }
}

const sessions = new Map<string, TabTranslation>();
const listeners = new Set<() => void>();
let version = 0;

function emit() {
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function session(tabId: string): TabTranslation | null {
  const exec = isolatedExec();
  if (!exec) return null;
  let current = sessions.get(tabId);
  if (!current) {
    current = new TabTranslation(exec);
    sessions.set(tabId, current);
  }
  return current;
}

export const pageTranslation = {
  pageLoaded(
    tabId: string,
    webContentsId: number,
    url: string,
    target: PageTranslationTarget,
  ) {
    void session(tabId)?.pageLoaded(webContentsId, url, target);
  },
  translate(
    tabId: string,
    webContentsId: number,
    mode: PageTranslationState["mode"],
    target: PageTranslationTarget,
  ) {
    void session(tabId)?.translate(webContentsId, mode, target);
  },
  showOriginal(tabId: string) {
    void sessions.get(tabId)?.showOriginal();
  },
  retry(tabId: string) {
    sessions.get(tabId)?.retry();
  },
  /** The tab closed: stop its pump. */
  forget(tabId: string) {
    sessions.get(tabId)?.close();
    sessions.delete(tabId);
    emit();
  },
  state(tabId: string | undefined): PageTranslationState {
    return (tabId && sessions.get(tabId)?.state) || IDLE;
  },
};

/** Live translation state for one tab. */
export function usePageTranslation(
  tabId: string | undefined,
): PageTranslationState {
  useSyncExternalStore(
    subscribe,
    () => version,
    () => version,
  );
  return pageTranslation.state(tabId);
}
