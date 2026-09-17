// Banner shown above the first message when thread/resume returned a
// paginated window (Conversation.hasMoreTurns). Clicking pages one more
// batch of older turns in; the hook ignores re-entrant calls, so the
// local pending flag is purely cosmetic.

import { useCallback, useEffect, useRef, useState } from "react";
import { HistoryIcon, Loader2Icon } from "lucide-react";

import { useI18n } from "@/core/i18n/hooks";
import { swallow } from "@/core/utils/log";

export function LoadOlderTurnsBanner({
  onLoad,
}: {
  onLoad: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);
  const bannerRef = useRef<HTMLDivElement | null>(null);
  // Auto-load arms only after the user scrolls at least once, so a short
  // first page (banner already in view on open) never triggers a fetch
  // storm that pages the entire history in uninvited.
  const userScrolledRef = useRef(false);

  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      await onLoad();
    } catch (err) {
      swallow(err);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [onLoad]);

  useEffect(() => {
    const arm = () => {
      userScrolledRef.current = true;
    };
    // Scroll does not bubble, but capture-phase listeners on window still
    // see scrolls from nested containers (the conversation viewport).
    window.addEventListener("scroll", arm, { capture: true, passive: true });
    window.addEventListener("wheel", arm, { passive: true });
    window.addEventListener("touchmove", arm, { passive: true });
    return () => {
      window.removeEventListener("scroll", arm, { capture: true });
      window.removeEventListener("wheel", arm);
      window.removeEventListener("touchmove", arm);
    };
  }, []);

  // Reaching the top of the loaded window is explicit intent to read older
  // turns: page the next batch in automatically. One load per viewport
  // entry — the banner must leave and re-enter view before the next
  // automatic page, so a chain of short pages cannot self-trigger. The
  // button remains as the manual fallback.
  useEffect(() => {
    const node = bannerRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (
            entry.isIntersecting &&
            userScrolledRef.current &&
            !loadingRef.current
          ) {
            void load();
          }
        }
      },
      { rootMargin: "200px 0px 0px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [load]);

  return (
    <div ref={bannerRef} className="flex justify-center py-1">
      <button
        type="button"
        onClick={() => void load()}
        disabled={loading}
        className="inline-flex items-center gap-1.5 rounded-full border border-border-default bg-muted/30 px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? (
          <Loader2Icon className="size-3.5 animate-spin" />
        ) : (
          <HistoryIcon className="size-3.5" />
        )}
        {loading ? t.message.loadingOlderTurns : t.message.loadOlderTurns}
      </button>
    </div>
  );
}
