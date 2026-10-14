import { Loader2Icon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";

import type { WebviewTabHandle } from "./webview-tab";

export type ReaderBlock = { text: string; heading: boolean };
type ReaderPage = { title: string; url: string; blocks: ReaderBlock[] };

const BODY_LINE = 80;
const SHORT_LINE = 40;
const FOOTER_LINKS = 6;
const FOOTER_PROSE = 2;

const isShort = (line: string) => line.length < SHORT_LINE;
const isBody = (line: string) => line.length >= BODY_LINE;

/**
 * Page text → reading blocks. Site navigation before the first real
 * paragraph and the footer (a run of link-only lines with little prose
 * after it) are dropped; a short line that introduces a paragraph reads as
 * a subheading.
 */
export function readerBlocks(text: string, title: string): ReaderBlock[] {
  const lines = text
    .split(/\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const firstBody = lines.findIndex(isBody);
  // Keep the line just before the first paragraph: usually its heading.
  let kept = firstBody > 0 ? lines.slice(firstBody - 1) : lines;
  if (firstBody >= 0) {
    let start = 1;
    while (start < kept.length) {
      let end = start;
      while (end < kept.length && isShort(kept[end]!)) end += 1;
      if (
        end - start >= FOOTER_LINKS &&
        kept.slice(end).filter(isBody).length <= FOOTER_PROSE
      ) {
        kept = kept.slice(0, start);
        break;
      }
      start = end + 1;
    }
  }
  const pageTitle = title.trim();
  const body = kept.filter((line) => line !== pageTitle);
  return body.map((line, index) => {
    const next = body[index + 1];
    return {
      text: line,
      heading:
        isShort(line) &&
        !/[。．.!?！？:：,，;；、)）]$/.test(line) &&
        next !== undefined &&
        !isShort(next),
    };
  });
}

/** Plain reading view of the current page's text, without the page chrome. */
export function ReaderView({
  handle,
  onClose,
}: {
  handle: WebviewTabHandle | null;
  onClose: () => void;
}) {
  const [page, setPage] = useState<ReaderPage | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (!handle) {
      setError("当前页面还没准备好");
      return;
    }
    handle
      .extractText()
      .then((result) => {
        if (cancelled) return;
        setPage({
          title: result.title,
          url: result.url,
          blocks: readerBlocks(result.text, result.title),
        });
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [handle]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-label="阅读模式"
      className="absolute inset-0 z-30 overflow-y-auto bg-background"
    >
      <button
        type="button"
        aria-label="退出阅读模式"
        onClick={onClose}
        className="sticky top-3 float-right mr-3 grid size-8 place-items-center rounded-full border border-border-subtle bg-background text-muted-foreground shadow-sm hover:text-foreground"
      >
        <XIcon className="size-4" />
      </button>
      <article className="mx-auto max-w-2xl px-6 py-12">
        {page ? (
          <>
            <h1 className="text-2xl font-semibold leading-snug">
              {page.title}
            </h1>
            <p className="mt-2 truncate text-xs text-muted-foreground">
              {page.url}
            </p>
            <div className="mt-8 space-y-4 text-[17px] leading-8 text-foreground/90">
              {page.blocks.map((block, index) =>
                block.heading ? (
                  <h2
                    key={index}
                    className="pt-2 text-lg font-semibold leading-snug text-foreground"
                  >
                    {block.text}
                  </h2>
                ) : (
                  <p key={index}>{block.text}</p>
                ),
              )}
            </div>
          </>
        ) : error ? (
          <p className="text-sm text-destructive">无法进入阅读模式：{error}</p>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" />
            正在整理页面内容…
          </p>
        )}
      </article>
    </div>
  );
}
