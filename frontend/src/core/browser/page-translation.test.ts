import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { EchoAPIError } from "@/core/api/client";

import { pageTranslation, setAlwaysTranslated } from "./page-translation";
import type { PageTranslatorApi } from "./page-translator";

const mocks = vi.hoisted(() => ({
  apiPost: vi.fn(),
}));

vi.mock("@/core/api/request", () => ({ apiPost: mocks.apiPost }));

type Body = { segments: { id: string; pieces: string[] }[] };

function answerInChinese() {
  mocks.apiPost.mockImplementation(
    async (_path: string, options: { body: Body }) => ({
      translations: options.body.segments.map((segment) => ({
        id: segment.id,
        pieces: segment.pieces.map((piece) => `«${piece.trim()}»`),
      })),
      model: "value",
      cached: 0,
    }),
  );
}

const ENGLISH = `
  <p id="one">${"The first paragraph talks about many things. ".repeat(2)}</p>
  <p id="two">${"The second paragraph explains the rest of it. ".repeat(2)}</p>`;

function installedTranslator() {
  return (
    globalThis as unknown as Record<string, PageTranslatorApi | undefined>
  ).__echoPageTranslator;
}

async function settle(ms = 2_000) {
  await vi.advanceTimersByTimeAsync(ms);
}

let tab = 0;
let tabId = "";

beforeEach(() => {
  vi.useFakeTimers();
  tab += 1;
  tabId = `tab-${tab}`;
  // Isolated-world execution, run against the test document.
  (window as unknown as { echo: unknown }).echo = {
    browser: {
      executeIsolated: async (_id: number, code: string) =>
        new Function(`return ${code};`)(),
    },
  };
  // jsdom never lays the page out; treat every block as on screen.
  window.IntersectionObserver =
    undefined as unknown as typeof IntersectionObserver;
  document.body.innerHTML = ENGLISH;
  answerInChinese();
});

afterEach(() => {
  pageTranslation.forget(tabId);
  installedTranslator()?.reset();
  delete (window as unknown as { echo?: unknown }).echo;
  localStorage.clear();
  mocks.apiPost.mockReset();
  vi.useRealTimers();
});

describe("page translation sessions", () => {
  test("detects, translates in place and shows the original again", async () => {
    pageTranslation.pageLoaded(tabId, 7, "https://example.com/a", "zh-CN");
    await settle(0);
    expect(pageTranslation.state(tabId).language).toMatchObject({
      foreign: true,
    });
    expect(mocks.apiPost).not.toHaveBeenCalled();

    pageTranslation.translate(tabId, 7, "translated", "zh-CN");
    await settle();

    expect(document.getElementById("one")!.textContent).toMatch(/^«The first/);
    expect(pageTranslation.state(tabId)).toMatchObject({
      active: true,
      busy: false,
      error: null,
      progress: { done: 2, pending: 0 },
    });

    pageTranslation.showOriginal(tabId);
    await settle();
    expect(document.getElementById("one")!.textContent).toMatch(/^The first/);
    expect(pageTranslation.state(tabId).active).toBe(false);
  });

  test("an always-translated site starts by itself", async () => {
    setAlwaysTranslated("https://example.com/other", true);

    pageTranslation.pageLoaded(tabId, 7, "https://example.com/a", "zh-CN");
    await settle();

    expect(pageTranslation.state(tabId).active).toBe(true);
    expect(document.getElementById("two")!.textContent).toMatch(/^«The second/);
  });

  test("keeps translating the next page in the same tab", async () => {
    pageTranslation.translate(tabId, 7, "translated", "zh-CN");
    await settle();
    expect(mocks.apiPost).toHaveBeenCalledTimes(1);

    // A new document: the old translator is gone with the old page.
    installedTranslator()?.reset();
    document.body.innerHTML = `<p id="next">${"A brand new page with its own words. ".repeat(3)}</p>`;
    await settle();

    expect(document.getElementById("next")!.textContent).toMatch(/^«A brand/);
  });

  test("stops on a failure and says why", async () => {
    mocks.apiPost.mockRejectedValue(
      new EchoAPIError(
        "还没有可用的翻译模型：请在设置里添加一个模型。",
        503,
        null,
      ),
    );

    pageTranslation.translate(tabId, 7, "translated", "zh-CN");
    await settle();

    expect(pageTranslation.state(tabId).error).toContain("添加一个模型");
    expect(document.getElementById("one")!.textContent).toMatch(/^The first/);
    const calls = mocks.apiPost.mock.calls.length;
    await settle(10_000);
    expect(mocks.apiPost.mock.calls.length).toBe(calls);

    answerInChinese();
    pageTranslation.retry(tabId);
    await settle();
    expect(pageTranslation.state(tabId).error).toBeNull();
    expect(document.getElementById("one")!.textContent).toMatch(/^«The first/);
  });
});
