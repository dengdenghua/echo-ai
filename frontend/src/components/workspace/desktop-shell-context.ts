import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

export const DesktopShellContext = createContext(false);
export const useDesktopShell = () => useContext(DesktopShellContext);

export const DesktopToolbarTarget = createContext<HTMLDivElement | null>(null);

// Keep surface controls in the shared title row without remounting the switch.
// Standalone surfaces retain their own inline toolbar.
export function DesktopToolbarContent({ children }: { children: ReactNode }) {
  const framed = useDesktopShell();
  const target = useContext(DesktopToolbarTarget);
  return framed ? (target ? createPortal(children, target) : null) : children;
}

export const DesktopSidebarState = createContext<{
  open: boolean;
  setOpen: (open: boolean) => void;
} | null>(null);
