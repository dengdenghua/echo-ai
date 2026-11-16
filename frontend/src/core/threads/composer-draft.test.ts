import { composerActionsCopy } from "@/core/i18n/locales/composer-actions";
import { beforeEach, describe, expect, it } from "vitest";

import {
  clearComposerDrafts,
  loadComposerDraft,
  NEW_THREAD_DRAFT_KEY,
  saveComposerDraft,
} from "./composer-draft";

const OWNER = "local:owner";
const READER = "local:reader";

describe("composer-draft", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("round-trips a draft per thread and account", () => {
    saveComposerDraft("t-1", "写了一半的消息", OWNER);
    expect(loadComposerDraft("t-1", OWNER)).toBe("写了一半的消息");
    expect(loadComposerDraft("t-2", OWNER)).toBeNull();
    expect(loadComposerDraft("t-1", READER)).toBeNull();
  });

  it("stores the new-thread composer under a dedicated key", () => {
    saveComposerDraft(undefined, "新会话草稿", OWNER);
    const raw = window.localStorage.getItem(
      `echo:composer-draft:v2:${encodeURIComponent(OWNER)}:${NEW_THREAD_DRAFT_KEY}`,
    );
    expect(raw).not.toBeNull();
    const envelope = JSON.parse(raw ?? "{}") as { v?: number; text?: string };
    expect(envelope.v).toBe(1);
    expect(envelope.text).toBe("新会话草稿");
    expect(loadComposerDraft(null, OWNER)).toBe("新会话草稿");
  });

  it("prunes drafts older than 30 days while keeping fresh ones", () => {
    const oldKey = `echo:composer-draft:v2:${encodeURIComponent(OWNER)}:stale-thread`;
    window.localStorage.setItem(
      oldKey,
      JSON.stringify({
        v: 1,
        text: "旧草稿",
        savedAt: Date.now() - 31 * 24 * 60 * 60 * 1000,
      }),
    );
    saveComposerDraft("fresh-thread", "新草稿", OWNER);
    expect(window.localStorage.getItem(oldKey)).toBeNull();
    expect(loadComposerDraft("fresh-thread", OWNER)).toBe("新草稿");
  });

  it("never revives a pre-scope draft for a signed-in account", () => {
    window.localStorage.setItem("echo:composer-draft:legacy", "老格式草稿");
    expect(loadComposerDraft("legacy", OWNER)).toBeNull();
  });

  it("clears the entry when the draft is emptied", () => {
    saveComposerDraft("t-1", "abc", OWNER);
    saveComposerDraft("t-1", "", OWNER);
    expect(loadComposerDraft("t-1", OWNER)).toBeNull();
  });

  it("erases only the signing-out account's drafts", () => {
    saveComposerDraft("t-1", "owner draft", OWNER);
    saveComposerDraft("t-1", "reader draft", READER);
    clearComposerDrafts(OWNER);
    expect(loadComposerDraft("t-1", OWNER)).toBeNull();
    expect(loadComposerDraft("t-1", READER)).toBe("reader draft");
  });

  it("never throws when storage is unavailable", () => {
    const original = window.localStorage;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: () => {
          throw new Error("denied");
        },
        setItem: () => {
          throw new Error("denied");
        },
        removeItem: () => {
          throw new Error("denied");
        },
      },
    });
    expect(() => saveComposerDraft("t-1", "x", OWNER)).not.toThrow();
    expect(loadComposerDraft("t-1", OWNER)).toBeNull();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: original,
    });
  });
});

it.each(["zh-CN", "en-US", "ja-JP", "ko-KR"])(
  "never restores an internal continuation draft in %s",
  (locale) => {
    const text = composerActionsCopy(locale).resumePrompt;
    const resumeKey = `echo:composer-draft:v2:${encodeURIComponent(OWNER)}:resume`;
    for (const raw of [
      text,
      JSON.stringify({ v: 1, text, savedAt: Date.now() }),
    ]) {
      window.localStorage.setItem(resumeKey, raw);
      expect(loadComposerDraft("resume", OWNER)).toBeNull();
      expect(window.localStorage.getItem(resumeKey)).toBeNull();
    }
    saveComposerDraft("resume", text, OWNER);
    expect(loadComposerDraft("resume", OWNER)).toBeNull();
    saveComposerDraft("resume", composerActionsCopy(locale).resume, OWNER);
    expect(loadComposerDraft("resume", OWNER)).toBe(
      composerActionsCopy(locale).resume,
    );
  },
);
