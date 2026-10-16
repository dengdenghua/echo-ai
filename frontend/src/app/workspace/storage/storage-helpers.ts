// Types, formatters and the asset hook shared by the storage page's views.
import { useEffect, useState } from "react";
import {
  AppWindowIcon,
  FileImageIcon,
  FileTextIcon,
  type LucideIcon,
} from "lucide-react";

import type { Translations } from "@/core/i18n/locales";
import {
  loadNASAssetURL,
  type NASApp,
  type NASFileAsset,
} from "@/core/storage/api";

export type LibraryKey =
  | "overview"
  | "apps"
  | "docs"
  | "images"
  | "videos"
  | "computer"
  | "sources";

export interface AppItem {
  id: string;
  name: string;
  type: string;
  path: string;
  status: string;
  icon: LucideIcon;
  tone: string;
  iconUrl?: string;
}

export interface DiskItem {
  name: string;
  path: string;
  type: string;
  size: string;
  icon: LucideIcon;
  active?: boolean;
  isDirectory?: boolean;
}

export interface FileItem {
  name: string;
  path: string;
  kind: string;
  updated: string;
  size: string;
  icon: LucideIcon;
  tone: string;
}

export type StorageCopy = Translations["storage"];

export interface LibraryMeta {
  key: LibraryKey;
  label: string;
  detail: string;
  icon: LucideIcon;
}

export const DOCUMENT_PAGE_SIZE = 60;
export const IMAGE_PAGE_SIZE = 96;

export function fill(
  template: string,
  vars: Record<string, string | number>,
): string {
  return Object.entries(vars).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
    template,
  );
}

export const delay = (ms: number) =>
  new Promise((resolve) => window.setTimeout(resolve, ms));

export function mapNASApp(item: NASApp, copy: StorageCopy): AppItem {
  const category =
    item.category === "system"
      ? copy.apps.typeSystemApp
      : item.category === "office"
        ? copy.apps.typeDocsSheets
        : copy.apps.typeWebResources;
  return {
    id: item.app_id,
    name: item.name,
    type: category,
    path: item.path,
    status: copy.apps.statusRegistered,
    icon: AppWindowIcon,
    tone:
      item.category === "system"
        ? "blue"
        : item.category === "office"
          ? "amber"
          : "violet",
    iconUrl: item.icon_available
      ? `/v1/apps/${encodeURIComponent(item.app_id)}/icon`
      : undefined,
  };
}

export function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 ** 2).toFixed(2)} MB`;
}

export function formatModified(mtimeNs: number): string {
  const date = new Date(mtimeNs / 1_000_000);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
        .format(date)
        .replaceAll("/", "-");
}

export function formatSeconds(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export type VideoPlayerHit = {
  videoPath: string;
  timeSec: number;
};

export type VideoPlayerTarget = {
  video: NASFileAsset;
  hits: VideoPlayerHit[];
  index: number;
};

export type DocumentSmartFilter =
  | "all"
  | "recent"
  | "pdf"
  | "office"
  | "sheet"
  | "text";
export type ImageSmartFilter =
  | "all"
  | "screenshot"
  | "receipt"
  | "document"
  | "photo";

export const DOCUMENT_SMART_FILTERS: Array<[DocumentSmartFilter, string]> = [
  ["all", "全部"],
  ["recent", "最近"],
  ["pdf", "PDF"],
  ["office", "Office"],
  ["sheet", "表格"],
  ["text", "文本"],
];

export const IMAGE_SMART_FILTERS: Array<[ImageSmartFilter, string]> = [
  ["all", "全部"],
  ["screenshot", "截图"],
  ["receipt", "票据"],
  ["document", "文档图"],
  ["photo", "照片"],
];

export function assetSearchText(asset: NASFileAsset): string {
  return `${asset.name} ${asset.path} ${asset.extension} ${(asset.ai_labels ?? []).join(" ")}`.toLocaleLowerCase();
}

export function matchesDocumentFilter(
  asset: NASFileAsset,
  filter: DocumentSmartFilter,
  newestMtime: number,
): boolean {
  const extension = asset.extension.replace(/^\./, "").toLowerCase();
  if (filter === "all") return true;
  if (filter === "recent")
    return newestMtime - asset.mtime_ns <= 30 * 24 * 60 * 60 * 1_000_000_000;
  if (filter === "pdf") return extension === "pdf";
  if (filter === "office")
    return ["doc", "docx", "ppt", "pptx", "xls", "xlsx"].includes(extension);
  if (filter === "sheet")
    return ["xls", "xlsx", "csv", "tsv"].includes(extension);
  return ["md", "txt", "html", "htm", "rtf"].includes(extension);
}

export function imageSmartCategory(
  asset: NASFileAsset,
): Exclude<ImageSmartFilter, "all"> {
  const aiLabels = asset.ai_labels ?? [];
  if (aiLabels.includes("screenshot")) return "screenshot";
  if (aiLabels.includes("receipt")) return "receipt";
  if (aiLabels.includes("document")) return "document";
  const text = assetSearchText(asset);
  const extension = asset.extension.replace(/^\./, "").toLowerCase();
  if (/(截图|screen ?shot|截屏|capture)/i.test(text)) return "screenshot";
  if (/(票据|收据|发票|报销|receipt|invoice)/i.test(text)) return "receipt";
  if (/(文档|报告|表格|ppt|pdf|doc|xls|logo|slide)/i.test(text))
    return "document";
  if (["png", "webp"].includes(extension)) return "screenshot";
  return "photo";
}

export function fileAssetToItem(asset: NASFileAsset): FileItem {
  const extension = asset.extension.replace(/^\./, "").toUpperCase() || "FILE";
  return {
    name: asset.name,
    path: asset.path,
    kind: extension,
    updated: formatModified(asset.mtime_ns),
    size: formatBytes(asset.size),
    icon: asset.kind === "image" ? FileImageIcon : FileTextIcon,
    tone: asset.kind === "image" ? "green" : "blue",
  };
}

export function useNASAsset(path: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!path) return;
    let disposed = false;
    let objectUrl: string | null = null;
    void loadNASAssetURL(path)
      .then((next) => {
        objectUrl = next;
        if (!disposed) setUrl(next);
      })
      .catch(() => setUrl(null));
    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);
  return url;
}

function _disk(
  name: string,
  path: string,
  type: string,
  size: string,
  icon: LucideIcon,
  active = false,
): DiskItem {
  return { name, path, type, size, icon, active };
}

export function toneClass(tone: string) {
  const classes: Record<string, string> = {
    blue: "bg-info/10 text-info",
    green: "bg-success/5 text-success",
    violet: "bg-chart-1/10 text-chart-1",
    amber: "bg-warning/5 text-warning",
    rose: "bg-destructive/5 text-destructive",
    zinc: "bg-muted text-muted-foreground",
  };
  return classes[tone] ?? tone;
}
