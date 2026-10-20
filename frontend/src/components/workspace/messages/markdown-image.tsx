import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ImgHTMLAttributes,
  type MouseEvent as ReactMouseEvent,
} from "react";

import { cn } from "@/lib/utils";

/**
 * Rich markdown image rendering for AI answers.
 *
 * Streamdown's default ``img`` renders a bare element: no loading state, no
 * zoom, and a broken layout shift when the URL resolves late. Streaming
 * markdown also re-parses the same fence repeatedly, so the component must
 * tolerate remounts without flashing a spinner over an already-cached image
 * (``complete`` on the element instance survives remount via the browser
 * cache probe below).
 *
 * Zoom is a plain portal-free fixed overlay instead of Radix Dialog: the
 * image must keep its natural size (not be constrained by dialog sizing),
 * and Esc/scroll-out dismissal is all the interaction a lightbox needs.
 */

type LoadState = "loading" | "loaded" | "error";

export function MarkdownImage({
  alt,
  className,
  ...props
}: ImgHTMLAttributes<HTMLImageElement>) {
  const src = typeof props.src === "string" ? props.src : "";
  const ref = useRef<HTMLImageElement | null>(null);
  // ``complete`` probes the browser cache synchronously: a remount of an
  // already-decoded image must not flash the skeleton again.
  const [state, setState] = useState<LoadState>(() =>
    ref.current?.complete && ref.current?.naturalWidth > 0
      ? "loaded"
      : "loading",
  );
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    setState(
      ref.current?.complete && ref.current.naturalWidth > 0
        ? "loaded"
        : "loading",
    );
    setZoomed(false);
  }, [src]);

  const open = useCallback((event: ReactMouseEvent) => {
    // Text selection across an image drag must not open the lightbox.
    if (window.getSelection()?.toString()) return;
    event.preventDefault();
    event.stopPropagation();
    setZoomed(true);
  }, []);

  useEffect(() => {
    if (!zoomed) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setZoomed(false);
    };
    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [zoomed]);

  const skeleton = useMemo(
    () => (
      <span
        aria-hidden="true"
        className="absolute inset-0 animate-pulse rounded-md bg-muted"
      />
    ),
    [],
  );

  return (
    <>
      <span
        className={cn(
          "relative my-2 block max-w-full cursor-zoom-in overflow-hidden rounded-md",
          state === "loading" && "min-h-24",
          className,
        )}
        onClick={open}
      >
        <img
          {...props}
          ref={ref}
          alt={alt ?? ""}
          draggable={false}
          className={cn(
            "max-h-[70vh] max-w-full select-none object-contain transition-opacity duration-200",
            state !== "loaded" && "opacity-0",
          )}
          onLoad={() => setState("loaded")}
          onError={() => setState("error")}
        />
        {state === "loading" && skeleton}
        {state === "error" && (
          <span className="flex min-h-24 items-center gap-2 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
            {alt ? `图片加载失败：${alt}` : "图片加载失败"}
          </span>
        )}
      </span>
      {zoomed && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={alt || "图片预览"}
          className="fixed inset-0 z-[80] flex cursor-zoom-out items-center justify-center bg-background/90 p-6 backdrop-blur-sm"
          onClick={() => setZoomed(false)}
        >
          {/* alt falls back to "" above; the dialog has its own aria-label */}
          <img
            {...props}
            alt={alt ?? ""}
            draggable={false}
            className="max-h-full max-w-full select-none object-contain shadow-2xl"
          />
        </div>
      )}
    </>
  );
}
