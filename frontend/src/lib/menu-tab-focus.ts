import type { KeyboardEvent } from "react";

const FOCUSABLE = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Radix menus swallow Tab, which strands plain buttons, tabs and inputs in a
 * panel-style dropdown (a model picker with source tabs and a search box).
 * Put this on such a DropdownMenuContent's onKeyDown: Tab / Shift+Tab then
 * cycle through the panel's own controls, while the arrow keys keep moving
 * between its menu items.
 */
export function moveTabFocusWithin(event: KeyboardEvent<HTMLElement>): void {
  if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) {
    return;
  }
  const controls = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE),
  );
  if (controls.length === 0) return;
  // Handled here, so Radix's own Tab handler (which only blocks it) is skipped.
  event.preventDefault();
  const current = controls.findIndex(
    (control) => control === document.activeElement,
  );
  const next = event.shiftKey
    ? current <= 0
      ? controls.length - 1
      : current - 1
    : (current + 1) % controls.length;
  controls[next]?.focus();
}
