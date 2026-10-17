import { FileIcon, Loader2Icon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { resolveArtifactURL } from "@/core/artifacts/utils";
import { useI18n } from "@/core/i18n/hooks";
import type { FileInMessage } from "@/core/messages/utils";

import { RoutedMessageLink } from "./routed-message-link";

/**
 * Get file extension and check helpers
 */
const getFileExt = (filename: string) =>
  filename.split(".").pop()?.toLowerCase() ?? "";

const FILE_TYPE_MAP: Record<string, string> = {
  json: "JSON",
  csv: "CSV",
  txt: "TXT",
  md: "Markdown",
  py: "Python",
  js: "JavaScript",
  ts: "TypeScript",
  tsx: "TSX",
  jsx: "JSX",
  html: "HTML",
  css: "CSS",
  xml: "XML",
  yaml: "YAML",
  yml: "YAML",
  pdf: "PDF",
  png: "PNG",
  jpg: "JPG",
  jpeg: "JPEG",
  gif: "GIF",
  svg: "SVG",
  zip: "ZIP",
  tar: "TAR",
  gz: "GZ",
};

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"];

function getFileTypeLabel(filename: string, fileFallback: string): string {
  const ext = getFileExt(filename);
  return FILE_TYPE_MAP[ext] ?? (ext.toUpperCase() || fileFallback);
}

function isImageFile(filename: string): boolean {
  return IMAGE_EXTENSIONS.includes(getFileExt(filename));
}

/**
 * Format bytes to human-readable size string
 */
function formatBytes(
  bytes: number,
  units: { b: string; kb: string; mb: string },
): string {
  if (bytes === 0) return `0 ${units.b}`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} ${units.kb}`;
  return `${(kb / 1024).toFixed(1)} ${units.mb}`;
}

/**
 * List of files from additional_kwargs.files (with optional upload status)
 */
export function RichFilesList({
  files,
  threadId,
}: {
  files: FileInMessage[];
  threadId: string;
}) {
  if (files.length === 0) return null;
  return (
    <div className="mb-2 flex flex-wrap justify-end gap-2">
      {files.map((file, index) => (
        <RichFileCard
          key={`${file.filename}-${index}`}
          file={file}
          threadId={threadId}
        />
      ))}
    </div>
  );
}

/**
 * Single file card that handles FileInMessage (supports uploading state)
 */
function RichFileCard({
  file,
  threadId,
}: {
  file: FileInMessage;
  threadId: string;
}) {
  const { t } = useI18n();
  const isUploading = file.status === "uploading";
  const isImage = isImageFile(file.filename);

  if (isUploading) {
    return (
      <div className="bg-background border-border-subtle flex max-w-50 min-w-30 flex-col gap-1 rounded-lg border p-3 opacity-60 shadow-[var(--shadow-xs)]">
        <div className="flex items-start gap-2">
          <Loader2Icon className="text-muted-foreground mt-0.5 size-4 shrink-0 animate-spin" />
          <span
            className="text-foreground truncate text-sm font-medium"
            title={file.filename}
          >
            {file.filename}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <Badge
            variant="secondary"
            className="rounded px-1.5 py-0.5 text-xs font-normal"
          >
            {getFileTypeLabel(file.filename, t.messageGrouping.fileFallback)}
          </Badge>
          <span className="text-muted-foreground text-xs">
            {t.uploads.uploading}
          </span>
        </div>
      </div>
    );
  }

  if (!file.path) return null;

  const fileUrl = resolveArtifactURL(file.path, threadId);

  if (isImage) {
    return (
      <RoutedMessageLink
        href={fileUrl}
        className="border-border-subtle relative block overflow-hidden rounded-lg border"
      >
        <img
          src={fileUrl}
          alt={file.filename}
          className="h-32 w-auto max-w-60 object-cover"
        />
      </RoutedMessageLink>
    );
  }

  return (
    <div className="bg-background border-border-subtle flex max-w-50 min-w-30 flex-col gap-1 rounded-lg border p-3 shadow-[var(--shadow-xs)]">
      <div className="flex items-start gap-2">
        <FileIcon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
        <span
          className="text-foreground truncate text-sm font-medium"
          title={file.filename}
        >
          {file.filename}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <Badge
          variant="secondary"
          className="rounded px-1.5 py-0.5 text-xs font-normal"
        >
          {getFileTypeLabel(file.filename, t.messageGrouping.fileFallback)}
        </Badge>
        <span className="text-muted-foreground text-xs">
          {formatBytes(file.size, {
            b: t.common.fileSizeB,
            kb: t.common.fileSizeKB,
            mb: t.common.fileSizeMB,
          })}
        </span>
      </div>
    </div>
  );
}
