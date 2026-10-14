import { useRef, useState } from "react";

type Point = { x: number; y: number };
export function imageRegion(start: Point, end: Point) {
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

export function MediaReference({
  url,
  type,
  path,
  zh,
  onQuote,
}: {
  url: string;
  type: string;
  path: string;
  zh: boolean;
  onQuote?: (reference: string) => void;
}) {
  const start = useRef<Point | undefined>(undefined);
  const [region, setRegion] = useState<ReturnType<typeof imageRegion>>();
  const [page, setPage] = useState("1");
  const [displayPage, setDisplayPage] = useState(1);
  const validPage = /^[1-9]\d{0,5}$/.test(page);
  const isImage = type.startsWith("image/");
  const point = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) / bounds.width,
      y: (event.clientY - bounds.top) / bounds.height,
    };
  };
  return (
    <div className="space-y-2">
      {isImage ? (
        <>
          {onQuote && (
            <p className="text-xs text-muted-foreground">
              {zh
                ? "在图片上拖动框选，或直接引用整张图片。"
                : "Drag to select a region, or reference the whole image."}
            </p>
          )}
          <div className="flex justify-center">
            <div
              className={`relative inline-flex max-w-full ${onQuote ? "touch-none cursor-crosshair" : ""}`}
              onPointerDown={
                onQuote
                  ? (event) => {
                      if (event.button !== 0) return;
                      event.currentTarget.setPointerCapture(event.pointerId);
                      start.current = point(event);
                      setRegion(undefined);
                    }
                  : undefined
              }
              onPointerMove={(event) => {
                if (start.current)
                  setRegion(imageRegion(start.current, point(event)));
              }}
              onPointerUp={(event) => {
                if (!start.current) return;
                const next = imageRegion(start.current, point(event));
                start.current = undefined;
                setRegion(
                  next.width >= 0.005 && next.height >= 0.005
                    ? next
                    : undefined,
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
                src={url}
                alt={path}
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
          </div>
        </>
      ) : (
        <>
          <iframe
            title={path}
            src={`${url}#page=${displayPage}`}
            className="h-[55vh] w-full"
          />
          {onQuote && (
            <div className="flex items-center gap-2 text-sm">
              <label>
                {zh ? "引用页码" : "Page to reference"}
                <input
                  aria-label={zh ? "引用页码" : "Page to reference"}
                  inputMode="numeric"
                  value={page}
                  onChange={(e) => setPage(e.target.value)}
                  className="ml-2 w-20 rounded border bg-transparent p-1"
                />
              </label>
              <button
                disabled={!validPage}
                onClick={() => setDisplayPage(Number(page))}
              >
                {zh ? "定位" : "Go to page"}
              </button>
            </div>
          )}
          {onQuote && (
            <p className="text-xs text-muted-foreground">
              {zh
                ? "请填写要引用的页码；PDF 阅读器内翻页不会同步此输入框。"
                : "Enter the page to reference; scrolling inside the PDF viewer does not update this field."}
            </p>
          )}
        </>
      )}
      {onQuote && (
        <div className="flex items-center gap-3 text-sm">
          <button
            className="rounded border px-3 py-2"
            disabled={!isImage && !validPage}
            onClick={() =>
              onQuote(
                isImage
                  ? `图片：${path}\n${region ? `框选区域（原图左上角为原点，百分比）：x=${(region.x * 100).toFixed(2)}%, y=${(region.y * 100).toFixed(2)}%, width=${(region.width * 100).toFixed(2)}%, height=${(region.height * 100).toFixed(2)}%` : "整张图片"}`
                  : `PDF：${path}\n引用第 ${page} 页（用户指定）`,
              )
            }
          >
            {isImage
              ? region
                ? zh
                  ? "引用选中区域"
                  : "Reference selected region"
                : zh
                  ? "引用图片"
                  : "Reference image"
              : zh
                ? "引用此页"
                : "Reference page"}
          </button>
          {region && (
            <button onClick={() => setRegion(undefined)}>
              {zh ? "清除框选" : "Clear selection"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
