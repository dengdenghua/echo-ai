import { ChevronDownIcon, ChevronUpIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { WebviewTabHandle } from "./webview-tab";

/**
 * Find in page: Enter / ↓ next, Shift+Enter / ↑ previous, Esc closes.
 * The desktop app reports the active match; the web build reports only a
 * count, so the bar keeps the position itself.
 */
export function FindBar({
  handle,
  onClose,
}: {
  handle: WebviewTabHandle | null;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<{
    matches: number;
    active: number;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastQuery = useRef("");
  const supported = Boolean(handle?.findInPage);

  useEffect(() => {
    inputRef.current?.focus();
    return () => handle?.stopFindInPage?.();
  }, [handle]);

  const find = async (forward: boolean) => {
    const query = text.trim();
    if (!handle?.findInPage || !query) {
      setResult(null);
      return;
    }
    const findNext = query === lastQuery.current;
    lastQuery.current = query;
    const next = await handle.findInPage(query, { forward, findNext });
    if (!next) {
      setResult({ matches: 0, active: 0 });
      return;
    }
    setResult((previous) => {
      if (next.active >= 0) return next;
      // Count only: step through 1..matches locally.
      if (!next.matches) return { matches: 0, active: 0 };
      const current =
        findNext && previous && previous.matches === next.matches
          ? previous.active
          : 0;
      const active = forward
        ? (current % next.matches) + 1
        : ((current - 2 + next.matches) % next.matches) + 1;
      return { matches: next.matches, active };
    });
  };

  return (
    <div
      role="search"
      aria-label="在页面中查找"
      className="absolute right-3 top-2 z-30 flex items-center gap-1 rounded-xl border border-border-subtle bg-popover px-2 py-1.5 shadow-lg"
    >
      <input
        ref={inputRef}
        value={text}
        aria-label="查找内容"
        placeholder={supported ? "在页面中查找" : "此页面不支持查找"}
        disabled={!supported}
        onChange={(event) => {
          setText(event.target.value);
          lastQuery.current = "";
          setResult(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void find(!event.shiftKey);
          } else if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
        className="h-7 w-48 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
      />
      <span
        className="min-w-12 text-right text-xs tabular-nums text-muted-foreground"
        aria-live="polite"
      >
        {result
          ? result.matches
            ? `${result.active}/${result.matches}`
            : "无结果"
          : ""}
      </span>
      <button
        type="button"
        aria-label="上一个"
        disabled={!supported || !text.trim()}
        onClick={() => void find(false)}
        className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
      >
        <ChevronUpIcon className="size-4" />
      </button>
      <button
        type="button"
        aria-label="下一个"
        disabled={!supported || !text.trim()}
        onClick={() => void find(true)}
        className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
      >
        <ChevronDownIcon className="size-4" />
      </button>
      <button
        type="button"
        aria-label="关闭查找"
        onClick={onClose}
        className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <XIcon className="size-4" />
      </button>
    </div>
  );
}
