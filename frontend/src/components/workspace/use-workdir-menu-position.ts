import { useCallback, useEffect, useState } from "react";
import type { RefObject } from "react";

const MENU_WIDTH = 360;
const MENU_MARGIN = 12;

/**
 * Fixed-position rect for the workdir selector's portal menu: anchored to
 * the trigger container, opening up or down toward the larger free space,
 * and kept in sync with resize/scroll while the menu is open.
 */
export function useWorkdirMenuPosition({
  containerRef,
  showMenu,
  isMutedVariant,
  noBridgeHint,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  showMenu: boolean;
  isMutedVariant: boolean;
  noBridgeHint: boolean;
}) {
  const [menuRect, setMenuRect] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);

  const updateMenuPosition = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const compactMutedMenu = isMutedVariant && !noBridgeHint;
    const targetWidth = compactMutedMenu ? 136 : MENU_WIDTH;
    const minWidth = compactMutedMenu ? 128 : 280;
    const _estimatedHeight = compactMutedMenu ? 56 : 260;
    const minHeight = compactMutedMenu ? 48 : 240;
    const width = Math.min(
      targetWidth,
      Math.max(minWidth, window.innerWidth - MENU_MARGIN * 2),
    );
    const preferredLeft = compactMutedMenu ? rect.left : rect.right - width;
    const left = Math.min(
      Math.max(MENU_MARGIN, preferredLeft),
      window.innerWidth - MENU_MARGIN - width,
    );
    const spaceBelow = window.innerHeight - rect.bottom - MENU_MARGIN;
    const spaceAbove = rect.top - MENU_MARGIN;
    const openUp = spaceAbove > spaceBelow;
    const maxHeight = Math.max(
      minHeight,
      openUp ? spaceAbove - 6 : spaceBelow - 6,
    );
    setMenuRect({
      left,
      width,
      maxHeight,
      ...(openUp
        ? { bottom: window.innerHeight - rect.top + 6 }
        : { top: rect.bottom + 6 }),
    });
  }, [containerRef, isMutedVariant, noBridgeHint]);

  useEffect(() => {
    if (!showMenu) {
      setMenuRect(null);
      return;
    }
    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [showMenu, updateMenuPosition]);

  return menuRect;
}
