// Device presets and screenshot pointer types for the agent browser preview.
import { MonitorIcon, SmartphoneIcon, TabletIcon } from "lucide-react";

import type { BrowserTab } from "@/components/browser/browser-store";

export const DEVICE_PREVIEW_PRESETS = {
  desktop: {
    label: "Desktop",
    width: 1440,
    height: 900,
    Icon: MonitorIcon,
  },
  laptop: {
    label: "Laptop",
    width: 1024,
    height: 768,
    Icon: MonitorIcon,
  },
  fourK: {
    label: "4K",
    width: 3840,
    height: 2160,
    Icon: MonitorIcon,
  },
  ipadAir: {
    label: "iPad Air",
    width: 768,
    height: 1024,
    Icon: TabletIcon,
  },
  ipadMini: {
    label: "iPad mini",
    width: 744,
    height: 1133,
    Icon: TabletIcon,
  },
  surfacePro7: {
    label: "Surface Pro",
    width: 912,
    height: 1368,
    Icon: TabletIcon,
  },
  surfaceDuo: {
    label: "Surface Duo",
    width: 540,
    height: 720,
    Icon: SmartphoneIcon,
  },
  iphone15ProMax: {
    label: "iPhone 15 PM",
    width: 430,
    height: 932,
    Icon: SmartphoneIcon,
  },
  pixel8: {
    label: "Pixel 8",
    width: 412,
    height: 915,
    Icon: SmartphoneIcon,
  },
  iphone15Pro: {
    label: "iPhone 15 Pro",
    width: 390,
    height: 844,
    Icon: SmartphoneIcon,
  },
  galaxyS24Ultra: {
    label: "Galaxy S24",
    width: 412,
    height: 915,
    Icon: SmartphoneIcon,
  },
  iphoneSE: {
    label: "iPhone SE",
    width: 375,
    height: 667,
    Icon: SmartphoneIcon,
  },
} as const;

export type DevicePreviewPreset = keyof typeof DEVICE_PREVIEW_PRESETS;
export type PreviewSurfaceMode = "screenshot" | "live";

export function isDevicePreviewPreset(
  value: string,
): value is DevicePreviewPreset {
  return Object.hasOwn(DEVICE_PREVIEW_PRESETS, value);
}

export interface ScreenshotPointerPoint {
  x: number;
  y: number;
  mode: "click" | "double";
  timestamp: number;
}

export function presetForViewport(
  width?: number,
  height?: number,
): DevicePreviewPreset | null {
  if (!width || !height) return null;
  const match = Object.keys(DEVICE_PREVIEW_PRESETS)
    .filter(isDevicePreviewPreset)
    .find((preset) => {
      const target = DEVICE_PREVIEW_PRESETS[preset];
      return target.width === width && target.height === height;
    });
  return match ?? null;
}

export function browserTabDeviceForPreset(
  preset: DevicePreviewPreset,
): BrowserTab["device"] {
  if (preset === "desktop" || preset === "laptop" || preset === "fourK") {
    return "desktop";
  }
  return DEVICE_PREVIEW_PRESETS[preset].width <= 540 ? "mobile" : "tablet";
}
