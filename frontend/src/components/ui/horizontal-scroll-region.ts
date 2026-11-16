import type { KeyboardEvent } from "react";

/** Home/End operate on an overflowing horizontal region, not the transcript. */
export function horizontalScrollKey(event: KeyboardEvent<HTMLElement>) {
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
  if (event.key !== "Home" && event.key !== "End") return;
  const viewport = event.currentTarget;
  if (viewport.scrollWidth <= viewport.clientWidth) return;
  event.preventDefault();
  event.stopPropagation();
  viewport.scrollLeft =
    event.key === "Home" ? 0 : viewport.scrollWidth - viewport.clientWidth;
}
