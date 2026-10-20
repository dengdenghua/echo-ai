import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

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
}

const GalleryContext = createContext<GalleryContextValue | null>(null);

let nextGalleryId = 1;

export function ImageGalleryScope({ children }: { children: ReactNode }) {
  // Registrations live in state so the lightbox re-renders as images
  // stream in; the counter ref keeps identity stable across remounts.
  const [images, setImages] = useState<(GalleryImage & { id: number })[]>([]);
  const context = useMemo<GalleryContextValue>(
    () => ({
      register: (image) => {
        const id = nextGalleryId++;
        setImages((prev) => [...prev, { ...image, id }]);
        return () => setImages((prev) => prev.filter((e) => e.id !== id));
      },
    }),
    [],
  );
  return (
    <GalleryContext.Provider value={context}>
      {children}
      {/* Portal keeps the lightbox above dialog overlays while staying
          inside React's event tree. */}
      <GalleryLightbox images={images} />
    </GalleryContext.Provider>
  );
}

interface LightboxState {
  index: number;
  images: (GalleryImage & { id: number })[];
}

let openLightbox: ((state: LightboxState) => void) | null = null;

export function openInGallery(index: number): boolean {
  if (!openLightbox || currentImages.length === 0) return false;
  openLightbox({ index, images: currentImages });
  return true;
}

// The scope's lightbox reads registrations at open time; a module-level
// mirror avoids threading the array back through the register callback.
let currentImages: (GalleryImage & { id: number })[] = [];

function GalleryLightbox({
  images,
}: {
  images: (GalleryImage & { id: number })[];
}) {
  const [state, setState] = useState<LightboxState | null>(null);
  useEffect(() => {
    currentImages = images;
    openLightbox = setState;
    return () => {
      if (openLightbox === setState) openLightbox = null;
    };
  }, [images]);
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
  }, [state]);
  if (!state || images.length === 0) return null;
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
      <img
        src={current.src}
        alt={current.alt}
        draggable={false}
        className="max-h-[75dvh] max-w-full select-none object-contain shadow-2xl"
        onClick={(event) => event.stopPropagation()}
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
                <img
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
  const serialized = `${image.src}:${image.alt}`;
  useEffect(() => {
    if (!context) return;
    return context.register(image);
    // Re-register only when the identity actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- image object identity is irrelevant
  }, [context, serialized]);
}

export function useGalleryLength(): number {
  // Images register during their effect phase; the count is read from the
  // module mirror at lightbox open time, so components only need a cheap
  // re-render signal. Keeping this hook out of the hot path: the length is
  // consumed by the lightbox itself, not by every image.
  return currentImages.length;
}
