import { useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from "react";

import { isObjectLike } from "@/core/utils/guards";
import { swallow } from "@/core/utils/log";

// Persist user-chosen dialog size across sessions so we don't reset on every
// open. localStorage is fine — the preference is per-browser, non-sensitive.
const DIALOG_SIZE_KEY = "echo_settings_dialog_size";
export const MIN_W = 560;
const MIN_H = 360;

function readSavedSize(): { w: number; h: number } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DIALOG_SIZE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      isObjectLike(parsed) &&
      typeof parsed.w === "number" &&
      typeof parsed.h === "number"
    ) {
      return { w: parsed.w, h: parsed.h };
    }
  } catch (e) {
    swallow(e);
  }
  return null;
}

/**
 * The settings dialog's user-resizable size: the corner drag handle, its
 * keyboard fallback, and the persisted value.
 */
export function useSettingsDialogSize() {
  // Null = "let the Tailwind default sizing apply". Once the user drags the
  // corner handle we switch to an inline width/height so DialogContent grows
  // symmetrically around its translate-[-50%,-50%] center anchor.
  const [size, setSize] = useState<{ w: number; h: number } | null>(() =>
    readSavedSize(),
  );
  const resizeStartRef = useRef<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);

  const onResizeStart = (e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const content = e.currentTarget.closest('[data-slot="dialog-content"]');
    if (!content) return;
    const rect = content.getBoundingClientRect();
    resizeStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      w: rect.width,
      h: rect.height,
    };
    const onMove = (ev: MouseEvent) => {
      const start = resizeStartRef.current;
      if (!start) return;
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      // Dialog is center-anchored, so corner drag of dx px moves the right
      // edge by dx — we need to grow width by 2*dx to keep the corner under
      // the cursor.
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const nextW = Math.max(MIN_W, Math.min(vw - 32, start.w + dx * 2));
      const nextH = Math.max(MIN_H, Math.min(vh - 32, start.h + dy * 2));
      setSize({ w: nextW, h: nextH });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      resizeStartRef.current = null;
      // Persist the last value we pushed into state. We read via a setter
      // callback to avoid a stale closure over `size`.
      setSize((latest) => {
        if (latest) {
          try {
            window.localStorage.setItem(
              DIALOG_SIZE_KEY,
              JSON.stringify(latest),
            );
          } catch (e) {
            swallow(e, "storage");
          }
        }
        return latest;
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // Keyboard fallback: arrow keys grow/shrink the dialog so
  // keyboard-only and screen-reader users can resize too.
  // Shift = 4× step. Home/End snaps to min/default.
  const onResizeKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 64 : 16;
    const current = size ?? {
      w: MIN_W + 200,
      h: MIN_H + 200,
    };
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const maxW = vw - 32;
    const maxH = vh - 32;
    let nextW = current.w;
    let nextH = current.h;
    switch (e.key) {
      case "ArrowRight":
        nextW = Math.min(maxW, current.w + step);
        break;
      case "ArrowLeft":
        nextW = Math.max(MIN_W, current.w - step);
        break;
      case "ArrowDown":
        nextH = Math.min(maxH, current.h + step);
        break;
      case "ArrowUp":
        nextH = Math.max(MIN_H, current.h - step);
        break;
      case "Home":
        nextW = MIN_W;
        nextH = MIN_H;
        break;
      case "End":
        nextW = Math.min(maxW, 1280);
        nextH = Math.min(maxH, 800);
        break;
      default:
        return;
    }
    e.preventDefault();
    const next = { w: nextW, h: nextH };
    setSize(next);
    try {
      window.localStorage.setItem(DIALOG_SIZE_KEY, JSON.stringify(next));
    } catch (err) {
      swallow(err, "storage");
    }
  };

  return { size, onResizeStart, onResizeKeyDown };
}
