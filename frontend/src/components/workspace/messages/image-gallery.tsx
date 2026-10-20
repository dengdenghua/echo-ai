import {
  createContext,
  useContext,
  useEffect,
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";
import { AuthenticatedImage } from "@/components/ui/authenticated-image";

/**
 * Per-answer image gallery.
 *
 * When one answer contains several images, each ``MessageImage`` registers
 * with the nearest ``ImageGalleryScope``; the lightbox then gains ◀ ▶
 * navigation and a thumbnail strip instead of forcing the user to close,
 * scroll, and re-open each image. Messages without the scope keep the
 * plain single-image lightbox — the hook degrades to index 0/length 1.
 */

export interface GalleryImage {
  src: string;
  alt: string;
}

interface GalleryContextValue {
  register: (image: GalleryImage) => () => void;
  open: (image: GalleryImage) => boolean;
  length: number;
}

const GalleryContext = createContext<GalleryContextValue | null>(null);

let nextGalleryId = 1;

export function ImageGalleryScope({ children }: { children: ReactNode }) {
  // Registrations live in state so the lightbox re-renders as images
  // stream in; the counter ref keeps identity stable across remounts.
  const [images, setImages] = useState<(GalleryImage & { id: number })[]>([]);
  const [state, setState] = useState<LightboxState | null>(null);
  const register = useCallback((image: GalleryImage) => {
    const id = nextGalleryId++;
    setImages((prev) => [...prev, { ...image, id }]);
    return () => setImages((prev) => prev.filter((e) => e.id !== id));
  }, []);
  const context = useMemo<GalleryContextValue>(
    () => ({
      register,
      length: images.length,
      open: (image) => {
        const index = images.findIndex(
          (entry) => entry.src === image.src && entry.alt === image.alt,
        );
        if (index < 0) return false;
        setState({ index, images });
        return true;
      },
    }),
    [images, register],
  );
  return (
    <GalleryContext.Provider value={context}>
      {children}
      {/* Portal keeps the lightbox above dialog overlays while staying
          inside React's event tree. */}
      <GalleryLightbox state={state} setState={setState} />
    </GalleryContext.Provider>
  );
}

interface LightboxState {
  index: number;
  images: (GalleryImage & { id: number })[];
}

function GalleryLightbox({
  state,
  setState,
}: {
  state: LightboxState | null;
  setState: React.Dispatch<React.SetStateAction<LightboxState | null>>;
}) {
  useEffect(() => {
    if (!state) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setState(null);
      if (event.key === "ArrowRight")
        setState((prev) =>
          prev && prev.images.length > 1
            ? { ...prev, index: (prev.index + 1) % prev.images.length }
            : prev,
        );
      if (event.key === "ArrowLeft")
        setState((prev) =>
          prev && prev.images.length > 1
            ? {
                ...prev,
                index:
                  (prev.index - 1 + prev.images.length) % prev.images.length,
              }
            : prev,
        );
    };
    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [state, setState]);
  if (!state || state.images.length === 0) return null;
  const images = state.images;
  const current = images[Math.min(state.index, images.length - 1)]!;
  const many = images.length > 1;
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={current.alt || "图片预览"}
      className="fixed inset-0 z-[80] flex flex-col items-center justify-center gap-3 bg-background/95 p-4 backdrop-blur-sm"
      onClick={() => setState(null)}
    >
      <button
        type="button"
        aria-label="关闭图片预览"
        className="absolute right-4 top-4 rounded border px-3 py-1"
        onClick={() => setState(null)}
      >
        关闭
      </button>
      <AuthenticatedImage
        key={current.src}
        src={current.src}
        alt={current.alt}
        draggable={false}
        className="max-h-[75dvh] max-w-full select-none object-contain shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        fallback={<span role="alert">图片读取失败，请关闭后重新打开。</span>}
      />
      {many && (
        <>
          <button
            type="button"
            aria-label="上一张"
            className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-background/80 p-2 text-foreground shadow-md transition-colors hover:bg-background"
            onClick={(event) => {
              event.stopPropagation();
              setState((prev) =>
                prev
                  ? {
                      ...prev,
                      index:
                        (prev.index - 1 + prev.images.length) %
                        prev.images.length,
                    }
                  : prev,
              );
            }}
          >
            ◀
          </button>
          <button
            type="button"
            aria-label="下一张"
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-background/80 p-2 text-foreground shadow-md transition-colors hover:bg-background"
            onClick={(event) => {
              event.stopPropagation();
              setState((prev) =>
                prev
                  ? { ...prev, index: (prev.index + 1) % prev.images.length }
                  : prev,
              );
            }}
          >
            ▶
          </button>
          <div
            className="flex max-w-full gap-2 overflow-x-auto"
            onClick={(event) => event.stopPropagation()}
          >
            {images.map((image, index) => (
              <button
                key={image.id}
                type="button"
                aria-label={`第 ${index + 1} 张`}
                aria-current={index === state.index}
                className={cn(
                  "size-14 shrink-0 overflow-hidden rounded border-2 transition-colors",
                  index === state.index
                    ? "border-primary"
                    : "border-transparent opacity-60 hover:opacity-100",
                )}
                onClick={() => setState({ index, images })}
              >
                <AuthenticatedImage
                  src={image.src}
                  alt=""
                  className="size-full object-cover"
                  draggable={false}
                />
              </button>
            ))}
          </div>
        </>
      )}
    </div>,
    document.body,
  );
}

export function useImageGalleryRegistration(image: GalleryImage) {
  const context = useContext(GalleryContext);
  const register = context?.register;
  useEffect(() => {
    if (!register || !image.src) return;
    return register({ src: image.src, alt: image.alt });
  }, [register, image.src, image.alt]);
  return () => context?.open(image) ?? false;
}

export function useGalleryLength(): number {
  // Images register during their effect phase; the count is read from the
  // module mirror at lightbox open time, so components only need a cheap
  // re-render signal. Keeping this hook out of the hot path: the length is
  // consumed by the lightbox itself, not by every image.
  return useContext(GalleryContext)?.length ?? 0;
}
