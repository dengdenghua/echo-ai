import { useEffect, useRef, useState, type HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

/**
 * Inline media cards for AI answers and artifacts.
 *
 * Echo previously rendered video/audio only as download links — the model
 * produces playable media (screen recordings, TTS, rendered animations) that
 * the UI could not play. These renderers attach to markdown code fences
 * (````video` / ````audio``) and to raw file references, keep the native
 * player chrome (seek/volume are not worth reimplementing), and add the
 * card frame + filename header the rest of the message cards share.
 */

function formatBytes(size: number | null | undefined): string | null {
  if (size == null || !Number.isFinite(size) || size <= 0) return null;
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export function VideoCard({
  src,
  filename,
  className,
  ...props
}: HTMLAttributes<HTMLVideoElement> & { src?: string; filename?: string }) {
  if (!src) return null;
  return (
    <section
      className={cn(
        "not-prose my-3 overflow-hidden rounded-lg border bg-muted/30",
        className,
      )}
      aria-label={filename || "视频"}
    >
      {filename && (
        <header className="flex items-center gap-2 border-b bg-muted/30 px-3 py-2 text-xs">
          <strong className="mr-auto truncate font-medium text-foreground">
            {filename}
          </strong>
          <a
            href={src}
            download
            className="rounded px-2 py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            下载
          </a>
        </header>
      )}
      <video
        {...props}
        src={src}
        controls
        preload="metadata"
        playsInline
        className="max-h-[70vh] w-full bg-black object-contain"
      />
    </section>
  );
}

export function AudioCard({
  src,
  filename,
  className,
  ...props
}: HTMLAttributes<HTMLAudioElement> & { src?: string; filename?: string }) {
  if (!src) return null;
  const size = formatBytes(null);
  return (
    <section
      className={cn(
        "not-prose my-3 flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2",
        className,
      )}
      aria-label={filename || "音频"}
    >
      <audio
        {...props}
        src={src}
        controls
        preload="metadata"
        className="min-w-0 flex-1"
      />
      {filename && (
        <span className="max-w-40 truncate text-xs text-muted-foreground">
          {filename}
          {size ? ` · ${size}` : ""}
        </span>
      )}
    </section>
  );
}

/**
 * Markdown-fence renderer: ```` ```video:path/to.mp4 ```` or a bare URL
 * fence whose extension resolves to media. Returns null for unknown
 * fences so the caller can fall back to the code block.
 */
export function mediaFromFence(
  code: string,
  language: string,
): { kind: "video" | "audio"; src: string; filename?: string } | null {
  const trimmed = code.trim();
  if (!trimmed) return null;
  // ````video\n<url>\n```` / ````audio\n<url>\n````
  const lang = language.toLowerCase();
  if (lang === "video" || lang === "audio") {
    const [firstLine = "", secondLine] = trimmed.split("\n");
    const src = firstLine.trim();
    if (!src) return null;
    return { kind: lang, src, filename: secondLine?.trim() || undefined };
  }
  // Bare URL fences: classify by extension.
  if (/^<https?:\/\//.test(trimmed) || /^https?:\/\/\S+$/.test(trimmed)) {
    const url = trimmed.replace(/^<|>$/g, "").split("\n")[0]?.trim() ?? "";
    if (!url) return null;
    const path = url.split(/[?#]/)[0] ?? "";
    if (/\.(mp4|webm|mov|m4v|ogv)$/i.test(path)) {
      return { kind: "video", src: url };
    }
    if (/\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(path)) {
      return { kind: "audio", src: url };
    }
  }
  return null;
}

/**
 * Skeleton shown while an inline visual iframe is still streaming —
 * replaces the previous blank pane so the user sees that rendering is
 * in progress rather than a hung card.
 */
export function VisualStreamSkeleton({ label }: { label: string }) {
  const [elapsed, setElapsed] = useState(0);
  const start = useRef(Date.now());
  useEffect(() => {
    const timer = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - start.current) / 1000)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div
      className="flex h-60 flex-col items-center justify-center gap-3 bg-muted/20"
      role="status"
      aria-live="polite"
    >
      <div className="flex gap-1.5" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="size-2 animate-bounce rounded-full bg-primary/50"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {label}
        {elapsed > 3 ? ` · ${elapsed}s` : ""}
      </p>
    </div>
  );
}
