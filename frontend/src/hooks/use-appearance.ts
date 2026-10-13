import { swallow } from "@/core/utils/log";
import { useCallback, useEffect, useState } from "react";

/**
 * Appearance preferences:
 *
 *   - cornerScale: global multiplier on all radius tokens (0.5–1.5).
 *       0.5 = crisp, 1 = default, 1.5 = pill / friendly.
 *   - density: global base font size and spacing scale for information
 *       density, from relaxed to ultra-dense.
 *
 * Persisted to localStorage and applied as data-* attributes on <html>
 * so any Tailwind/CSS rule can react via data attributes.
 */

export type CornerScale = 0.5 | 0.75 | 1 | 1.25 | 1.5;
export type Density =
  | "relaxed"
  | "comfortable"
  | "compact"
  | "dense"
  | "ultradense";

/**
 * 配色：ECHO 家族只有一套配色（石墨 / 雪白，只亮一点 core 青光）。曾经的
 * 可选配色（rouge 樱花粉、steel 经典蓝、apricot、violet、mint、teal、emerald、
 * amber 以及自定义主色）会带回品牌之外的色相，已经移除（AI-27）；本地存过的
 * 旧配色 id 在读取时迁回 "echo"。
 */
export type Palette = "echo";

const CORNER_KEY = "echo-corner-scale";
const DENSITY_KEY = "echo-density";
const PALETTE_KEY = "echo-palette";
/** Legacy key from the removed custom-colour palette; cleared on load. */
const CUSTOM_COLOR_KEY = "echo-custom-color";
const APPEARANCE_CHANGE_EVENT = "echo:appearance-change";

const DEFAULT_CORNER: CornerScale = 1;
const DEFAULT_DENSITY: Density = "comfortable";
const DEFAULT_PALETTE: Palette = "echo";

/** CSS variables the removed custom palette wrote inline on <html>. */
const LEGACY_CUSTOM_PALETTE_VARS = [
  "--primary",
  "--primary-foreground",
  "--ring",
  "--sidebar-primary",
  "--sidebar-primary-foreground",
  "--sidebar-ring",
  "--chart-1",
] as const;

const DENSITY_TOKENS: Record<
  Density,
  {
    baseFontSize: string;
    cardMinHeight: string;
    gap: string;
    headerPaddingX: string;
    headerPaddingY: string;
    pagePadding: string;
    panelPadding: string;
    rowPaddingX: string;
    rowPaddingY: string;
  }
> = {
  relaxed: {
    baseFontSize: "16px",
    rowPaddingY: "calc(var(--spacing) * 1.75)",
    rowPaddingX: "calc(var(--spacing) * 3)",
    gap: "calc(var(--spacing) * 5)",
    pagePadding: "calc(var(--spacing) * 5)",
    panelPadding: "calc(var(--spacing) * 5)",
    headerPaddingY: "calc(var(--spacing) * 3.5)",
    headerPaddingX: "calc(var(--spacing) * 5.5)",
    cardMinHeight: "204px",
  },
  comfortable: {
    baseFontSize: "15px",
    rowPaddingY: "calc(var(--spacing) * 1.5)",
    rowPaddingX: "calc(var(--spacing) * 2.5)",
    gap: "calc(var(--spacing) * 4)",
    pagePadding: "calc(var(--spacing) * 4)",
    panelPadding: "calc(var(--spacing) * 4)",
    headerPaddingY: "calc(var(--spacing) * 3)",
    headerPaddingX: "calc(var(--spacing) * 5)",
    cardMinHeight: "184px",
  },
  compact: {
    baseFontSize: "14px",
    rowPaddingY: "calc(var(--spacing) * 1.25)",
    rowPaddingX: "calc(var(--spacing) * 2)",
    gap: "calc(var(--spacing) * 3)",
    pagePadding: "calc(var(--spacing) * 3.5)",
    panelPadding: "calc(var(--spacing) * 3.5)",
    headerPaddingY: "calc(var(--spacing) * 2.5)",
    headerPaddingX: "calc(var(--spacing) * 4)",
    cardMinHeight: "168px",
  },
  dense: {
    baseFontSize: "13px",
    rowPaddingY: "calc(var(--spacing) * 1)",
    rowPaddingX: "calc(var(--spacing) * 1.75)",
    gap: "calc(var(--spacing) * 2.5)",
    pagePadding: "calc(var(--spacing) * 3)",
    panelPadding: "calc(var(--spacing) * 3)",
    headerPaddingY: "calc(var(--spacing) * 2)",
    headerPaddingX: "calc(var(--spacing) * 3.5)",
    cardMinHeight: "152px",
  },
  ultradense: {
    baseFontSize: "12.5px",
    rowPaddingY: "calc(var(--spacing) * 0.75)",
    rowPaddingX: "calc(var(--spacing) * 1.5)",
    gap: "calc(var(--spacing) * 2)",
    pagePadding: "calc(var(--spacing) * 2.5)",
    panelPadding: "calc(var(--spacing) * 2.5)",
    headerPaddingY: "calc(var(--spacing) * 1.75)",
    headerPaddingX: "calc(var(--spacing) * 3)",
    cardMinHeight: "136px",
  },
};

function readCorner(): CornerScale {
  if (typeof window === "undefined") return DEFAULT_CORNER;
  const raw = window.localStorage.getItem(CORNER_KEY);
  const v = raw != null ? Number(raw) : NaN;
  return ([0.5, 0.75, 1, 1.25, 1.5] as const).includes(v as CornerScale)
    ? (v as CornerScale)
    : DEFAULT_CORNER;
}

function readDensity(): Density {
  if (typeof window === "undefined") return DEFAULT_DENSITY;
  const raw = window.localStorage.getItem(DENSITY_KEY);
  return isDensity(raw) ? raw : DEFAULT_DENSITY;
}

function isDensity(value: string | null): value is Density {
  return (
    value === "relaxed" ||
    value === "comfortable" ||
    value === "compact" ||
    value === "dense" ||
    value === "ultradense"
  );
}

/**
 * ECHO is the only palette. Any other stored id (rouge, steel, apricot,
 * violet, mint, teal, emerald, amber, custom) is migrated to "echo" and the
 * stored custom colour is dropped, so an old preference cannot bring back an
 * off-brand accent or a green success colour.
 */
function readPalette(): Palette {
  if (typeof window === "undefined") return DEFAULT_PALETTE;
  try {
    const raw = window.localStorage.getItem(PALETTE_KEY);
    if (raw !== null && raw !== DEFAULT_PALETTE) {
      window.localStorage.setItem(PALETTE_KEY, DEFAULT_PALETTE);
    }
    window.localStorage.removeItem(CUSTOM_COLOR_KEY);
  } catch (e) {
    swallow(e, "storage");
  }
  return DEFAULT_PALETTE;
}

function applyPalette() {
  const root = document.documentElement;
  // ECHO is the unscoped base theme in globals.css: no [data-theme] scope and
  // no inline accent overrides left behind by the removed custom palette.
  delete root.dataset.theme;
  for (const v of LEGACY_CUSTOM_PALETTE_VARS) root.style.removeProperty(v);
}

function applyCorner(scale: CornerScale) {
  const root = document.documentElement;
  root.style.setProperty("--corner-radius-scale", String(scale));
  root.dataset.cornerScale = String(scale);
}

function applyDensity(density: Density) {
  const root = document.documentElement;
  const tokens = DENSITY_TOKENS[density];
  root.style.setProperty("--density-base-font-size", tokens.baseFontSize);
  root.style.setProperty("--density-row-padding-y", tokens.rowPaddingY);
  root.style.setProperty("--density-row-padding-x", tokens.rowPaddingX);
  root.style.setProperty("--density-gap", tokens.gap);
  root.style.setProperty("--density-page-padding", tokens.pagePadding);
  root.style.setProperty("--density-panel-padding", tokens.panelPadding);
  root.style.setProperty("--density-header-padding-y", tokens.headerPaddingY);
  root.style.setProperty("--density-header-padding-x", tokens.headerPaddingX);
  root.style.setProperty("--density-card-min-height", tokens.cardMinHeight);
  if (density === DEFAULT_DENSITY) delete root.dataset.density;
  else root.dataset.density = density;
}

function emitAppearanceChange() {
  window.dispatchEvent(new Event(APPEARANCE_CHANGE_EVENT));
}

export function useAppearance() {
  const [cornerScale, setCornerScaleState] =
    useState<CornerScale>(DEFAULT_CORNER);
  const [density, setDensityState] = useState<Density>(DEFAULT_DENSITY);
  const [palette, setPaletteState] = useState<Palette>(DEFAULT_PALETTE);

  useEffect(() => {
    const syncFromStorage = () => {
      const c = readCorner();
      const d = readDensity();
      const p = readPalette();
      setCornerScaleState(c);
      setDensityState(d);
      setPaletteState(p);
      applyCorner(c);
      applyDensity(d);
      applyPalette();
    };

    syncFromStorage();
    window.addEventListener(APPEARANCE_CHANGE_EVENT, syncFromStorage);
    window.addEventListener("storage", syncFromStorage);
    return () => {
      window.removeEventListener(APPEARANCE_CHANGE_EVENT, syncFromStorage);
      window.removeEventListener("storage", syncFromStorage);
    };
  }, []);

  const setCornerScale = useCallback((scale: CornerScale) => {
    setCornerScaleState(scale);
    applyCorner(scale);
    try {
      window.localStorage.setItem(CORNER_KEY, String(scale));
    } catch (e) {
      swallow(e, "storage");
    }
    emitAppearanceChange();
  }, []);

  const setDensity = useCallback((d: Density) => {
    setDensityState(d);
    applyDensity(d);
    try {
      window.localStorage.setItem(DENSITY_KEY, d);
    } catch (e) {
      swallow(e, "storage");
    }
    emitAppearanceChange();
  }, []);

  const setPalette = useCallback((p: Palette) => {
    setPaletteState(p);
    applyPalette();
    try {
      window.localStorage.setItem(PALETTE_KEY, p);
    } catch (e) {
      swallow(e, "storage");
    }
    emitAppearanceChange();
  }, []);

  return {
    cornerScale,
    density,
    palette,
    setCornerScale,
    setDensity,
    setPalette,
  };
}

/** Mount once at app root to hydrate appearance from storage before first paint. */
export function AppearanceBootstrap() {
  useAppearance();
  return null;
}
