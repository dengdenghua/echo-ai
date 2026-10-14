import { XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useI18n } from "@/core/i18n/hooks";
import type { ExtensionSidePanelState } from "@/types/electron";

/** Reserves layout space and positions the isolated native extension view. */
export function ExtensionSidePanel() {
  const { t } = useI18n();
  const [panel, setPanel] = useState<ExtensionSidePanelState | null>(null);
  const surface = useRef<HTMLDivElement>(null);
  const api = window.echo?.extensions;

  useEffect(() => {
    if (!api?.sidePanelState) return;
    let live = true;
    let revision = 0;
    const off = window.echo?.on("browser:extension-side-panel-changed", () => {
      const query = ++revision;
      void api.sidePanelState().then((state) => {
        if (live && query === revision) setPanel(state);
      });
    });
    const query = ++revision;
    void api.sidePanelState().then((state) => {
      if (live && query === revision) setPanel(state);
    });
    return () => {
      live = false;
      off?.();
    };
  }, [api]);

  useEffect(() => {
    const element = surface.current;
    if (!panel || !element || !api?.setSidePanelBounds) return;
    const measure = () => {
      const bounds = element.getBoundingClientRect();
      void api.setSidePanelBounds(
        bounds.width > 0 && bounds.height > 0
          ? {
              left: bounds.left,
              top: bounds.top,
              width: bounds.width,
              height: bounds.height,
            }
          : null,
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      void api.setSidePanelBounds(null);
    };
  }, [api, panel]);

  if (!panel) return null;
  return (
    <aside
      data-extension-side-panel={panel.id}
      aria-label={panel.name}
      className="flex h-full min-h-0 shrink-0 flex-col border-l border-border-default bg-background"
      style={{ width: "min(380px, 45%)" }}
    >
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border-default px-3">
        <span className="truncate text-sm font-medium">{panel.name}</span>
        <button
          type="button"
          aria-label={t.common.close}
          title={t.common.close}
          onClick={() => void api?.closeSidePanel(panel.id)}
          className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <XIcon className="size-4" />
        </button>
      </div>
      <div
        ref={surface}
        data-extension-side-panel-surface
        className="min-h-0 flex-1"
      />
    </aside>
  );
}
