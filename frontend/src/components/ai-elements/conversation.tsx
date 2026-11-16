import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowDownIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";
import {
  captureReadingPosition,
  readReadingPosition,
  restoreReadingPosition,
  saveReadingPosition,
} from "@/core/threads/conversation-view-state";

export type ConversationProps = ComponentProps<typeof StickToBottom> & {
  storageKey?: string;
  restorationReady?: boolean;
};

export const Conversation = ({
  className,
  storageKey,
  restorationReady = true,
  children,
  ...props
}: ConversationProps) => (
  <StickToBottom
    key={storageKey}
    className={cn(
      "relative flex-1 overflow-x-hidden overflow-y-hidden",
      className,
    )}
    // Streaming content changes height every frame. A smooth resize scroll
    // starts a new animation for each measurement, which can visibly wobble
    // while the user is wheel-scrolling or when the latest button is pressed.
    // Keep resize reconciliation deterministic; explicit user navigation can
    // still opt into animation below.
    initial={
      storageKey && readReadingPosition(storageKey)?.atBottom === false
        ? false
        : "instant"
    }
    resize="instant"
    role="log"
    {...props}
  >
    {(context) => (
      <>
        {storageKey && (
          <ConversationReadingPosition
            storageKey={storageKey}
            ready={restorationReady}
          />
        )}
        {typeof children === "function" ? children(context) : children}
      </>
    )}
  </StickToBottom>
);

export function ConversationReadingPosition({
  storageKey,
  ready,
}: {
  storageKey: string;
  ready: boolean;
}) {
  const { scrollRef, contentRef, stopScroll, scrollToBottom } =
    useStickToBottomContext();
  useLayoutEffect(() => {
    const saved = readReadingPosition(storageKey);
    // Release the lock before passive stream effects run, even while the
    // durable snapshot is still loading. Reconnection must not steal a reader.
    if (saved?.atBottom === false) stopScroll();
    const root = scrollRef.current;
    if (!ready || !root) return;
    let restoring = Boolean(saved && !saved.atBottom);
    let frame = 0;
    const started = performance.now();
    const deadline = started + 2000;
    let stableSince = started;
    let previousHeight = -1;
    const save = () => {
      if (!restoring)
        saveReadingPosition(storageKey, captureReadingPosition(root));
    };
    const restore = () => {
      frame = 0;
      if (!saved || !restoring) return;
      const found = restoreReadingPosition(root, saved);
      const now = performance.now();
      if (!found || root.scrollHeight !== previousHeight) stableSince = now;
      previousHeight = root.scrollHeight;
      // Virtualized history mounts after intersection/layout observations.
      // A few frames are not enough: keep the anchor until that layout settles.
      if (
        (found && now - started >= 400 && now - stableSince >= 120) ||
        now >= deadline
      ) {
        restoring = false;
        save();
      } else frame = requestAnimationFrame(restore);
    };
    const onScroll = () => {
      if (restoring || frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        save();
      });
    };
    const onUserInput = () => {
      restoring = false;
      cancelAnimationFrame(frame);
      frame = 0;
    };
    if (restoring) frame = requestAnimationFrame(restore);
    else if (saved?.atBottom) void scrollToBottom({ animation: "instant" });
    root.addEventListener("scroll", onScroll, { passive: true });
    root.addEventListener("wheel", onUserInput, { passive: true });
    root.addEventListener("touchstart", onUserInput, { passive: true });
    root.addEventListener("keydown", onUserInput);
    root.addEventListener("pointerdown", onUserInput);
    window.addEventListener("pagehide", save);
    return () => {
      save();
      cancelAnimationFrame(frame);
      root.removeEventListener("scroll", onScroll);
      root.removeEventListener("wheel", onUserInput);
      root.removeEventListener("touchstart", onUserInput);
      root.removeEventListener("keydown", onUserInput);
      root.removeEventListener("pointerdown", onUserInput);
      window.removeEventListener("pagehide", save);
    };
  }, [storageKey, ready, scrollRef, contentRef, stopScroll, scrollToBottom]);
  return null;
}

export type ConversationContentProps = ComponentProps<
  typeof StickToBottom.Content
>;

export const ConversationContent = ({
  className,
  ...props
}: ConversationContentProps) => (
  <StickToBottom.Content
    className={cn("flex flex-col gap-8 overflow-x-hidden p-4", className)}
    {...props}
  />
);

export type ConversationEmptyStateProps = ComponentProps<"div"> & {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
};

export const ConversationEmptyState = ({
  className,
  title = "No messages yet",
  description = "Start a conversation to see messages here",
  icon,
  children,
  ...props
}: ConversationEmptyStateProps) => (
  <div
    className={cn(
      "flex size-full flex-col items-center justify-center gap-3 p-8 text-center",
      className,
    )}
    {...props}
  >
    {children ?? (
      <>
        {icon && (
          <div className="flex items-center justify-center rounded-lg bg-primary/5 p-5">
            <div className="text-muted-foreground [&_svg]:size-8">{icon}</div>
          </div>
        )}
        <div className="space-y-1.5 max-w-xs">
          <h3 className="text-sm font-medium">{title}</h3>
          {description && (
            <p className="text-muted-foreground text-sm leading-relaxed">
              {description}
            </p>
          )}
        </div>
      </>
    )}
  </div>
);

export type ConversationScrollButtonProps = Omit<
  ComponentProps<typeof Button>,
  "children"
> & {
  children?: ReactNode;
  activityKey?: string | number;
  activityLabel?: (count: number) => ReactNode;
};

export const ConversationScrollButton = ({
  activityKey,
  activityLabel,
  className,
  children,
  ...props
}: ConversationScrollButtonProps) => {
  const { escapedFromLock, isAtBottom, scrollToBottom, state } =
    useStickToBottomContext();
  const previousActivityKey = useRef(activityKey);
  const [pendingActivityCount, setPendingActivityCount] = useState(0);

  useEffect(() => {
    if (Object.is(previousActivityKey.current, activityKey)) return;
    previousActivityKey.current = activityKey;
    // The underlying ResizeObserver can briefly lose its bottom lock when a
    // streamed response grows from shorter than the viewport to taller than
    // it. That left a brand-new task parked at scrollTop=0 even though the
    // reader never moved away. Preserve the library's explicit escape signal:
    // Read the synchronous escape signal as well: a wheel event can precede
    // React's next render. Auto-follow must itself remain interruptible.
    if (!escapedFromLock && !state.escapedFromLock) {
      void scrollToBottom({ animation: "instant", ignoreEscapes: false });
      return;
    }
    // activityKey can advance once per streamed frame. Treat unseen activity
    // as a boolean signal instead of counting transport chunks; otherwise a
    // long answer produces labels such as "685 new updates" and keeps
    // re-rendering this control while the reader is browsing older content.
    if (!isAtBottom) setPendingActivityCount(1);
  }, [activityKey, escapedFromLock, isAtBottom, scrollToBottom, state]);

  useEffect(() => {
    if (isAtBottom) setPendingActivityCount(0);
  }, [isAtBottom]);

  const handleScrollToBottom = useCallback(() => {
    setPendingActivityCount(0);
    // Smooth for the explicit button so the jump doesn't feel abrupt; the
    // streaming auto-follow above stays "instant" to avoid jitter.
    scrollToBottom({ animation: "smooth" });
  }, [scrollToBottom]);

  const label =
    pendingActivityCount > 0 && activityLabel
      ? activityLabel(pendingActivityCount)
      : children;

  return (
    !isAtBottom && (
      <Button
        className={cn(
          "absolute bottom-4 left-1/2 z-40 flex items-center gap-1.5 -translate-x-1/2 rounded-full border-border-default bg-background/92 px-3 text-xs shadow-[var(--shadow-md)] shadow-black/10 backdrop-blur-md transition-all duration-base hover:bg-background hover:scale-105 active:scale-95",
          className,
        )}
        onClick={handleScrollToBottom}
        size={label ? "sm" : "icon-sm"}
        type="button"
        variant="outline"
        {...props}
      >
        {pendingActivityCount > 0 && (
          <span className="relative flex size-2 shrink-0">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-primary" />
          </span>
        )}
        <ArrowDownIcon className="size-3.5 shrink-0" />
        {label}
      </Button>
    )
  );
};
