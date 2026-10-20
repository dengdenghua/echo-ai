import { useEffect, useRef, useState } from "react";

import { quoteIntoTask } from "@/core/threads/task-interaction";

/**
 * Circle-to-edit on generated images.
 *
 * Reuses the exact percent-coordinate contract ``MediaReference`` already
 * speaks (origin = image top-left, values 0-100 with two decimals) so the
 * model side needs no new parsing. The quote text marks itself as a region
 * edit so the prompt builder can attach the referenced image; plain image
 * references keep their existing format.
 */

type Point = { x: number; y: number };

export function imageRegionFrom(start: Point, end: Point) {
  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  const x = Math.min(clamp(start.x), clamp(end.x));
  const y = Math.min(clamp(start.y), clamp(end.y));
  return {
    x,
    y,
    width: Math.abs(clamp(end.x) - clamp(start.x)),
    height: Math.abs(clamp(end.y) - clamp(start.y)),
  };
}

export function ImageRegionSelector({
  src,
  alt,
  threadId,
  filename,
  disabled,
}: {
  src: string;
  alt: string;
  threadId?: string;
  filename?: string;
  disabled?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const start = useRef<Point | undefined>(undefined);
  const [region, setRegion] = useState<
    ReturnType<typeof imageRegionFrom> | undefined
  >(undefined);
  const point = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) / bounds.width,
      y: (event.clientY - bounds.top) / bounds.height,
    };
  };
  useEffect(() => {
    setRegion(undefined);
  }, [src]);
  if (disabled || !threadId) {
    return (
      <div className="relative inline-block max-w-full">
        <img src={src} alt={alt} draggable={false} className="block max-w-full select-none object-contain" />
      </div>
    );
  }
  const quote = () => {
    if (!region) return;
    quoteIntoTask(
      threadId,
      [
        `图片区域修改：${filename || alt || "生成图"}`,
        `区域（原图左上角为原点，百分比）：x=${(region.x * 100).toFixed(2)}%, y=${(region.y * 100).toFixed(2)}%, width=${(region.width * 100).toFixed(2)}%, height=${(region.height * 100).toFixed(2)}%`,
        "请只修改框选区域，保持其余部分不变。",
      ].join("\n"),
    );
    setRegion(undefined);
  };
  return (
    <div className="flex flex-col items-center gap-2">
      <div
        ref={containerRef}
        className="relative inline-block max-w-full cursor-crosshair touch-none select-none"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          start.current = point(event);
          setRegion(undefined);
        }}
        onPointerMove={(event) => {
          if (start.current) setRegion(imageRegionFrom(start.current, point(event)));
        }}
        onPointerUp={(event) => {
          if (!start.current) return;
          const next = imageRegionFrom(start.current, point(event));
          start.current = undefined;
          setRegion(
            next.width >= 0.01 && next.height >= 0.01 ? next : undefined,
          );
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          start.current = undefined;
          setRegion(undefined);
        }}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          className="block max-h-[55vh] max-w-full select-none object-contain"
        />
        {region && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute border-2 border-primary bg-primary/15"
            style={{
              left: `${region.x * 100}%`,
              top: `${region.y * 100}%`,
              width: `${region.width * 100}%`,
              height: `${region.height * 100}%`,
            }}
          />
        )}
      </div>
      {region ? (
        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            className="rounded-md border bg-primary/10 px-3 py-1.5 font-medium text-primary transition-colors hover:bg-primary/20"
            onClick={quote}
          >
            引用选中区域修改
          </button>
          <button
            type="button"
            className="rounded-md px-2 py-1.5 text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => setRegion(undefined)}
          >
            清除
          </button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          在图上拖动框选要修改的区域
        </p>
      )}
    </div>
  );
}
