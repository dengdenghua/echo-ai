const PREFIX = "file-reference:";
export interface FilePreviewReference {
  path: string;
  threadId: string;
  basePath?: string;
  lines?: string;
}

export function filePreviewRef(reference: FilePreviewReference): string {
  return PREFIX + encodeURIComponent(JSON.stringify(reference));
}

export function parseFilePreviewRef(
  value: string,
): FilePreviewReference | null {
  if (!value.startsWith(PREFIX)) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(value.slice(PREFIX.length)));
    if (
      !parsed ||
      typeof parsed.path !== "string" ||
      !parsed.path.trim() ||
      typeof parsed.threadId !== "string"
    )
      return null;
    if (parsed.basePath !== undefined && typeof parsed.basePath !== "string")
      return null;
    if (parsed.lines !== undefined && typeof parsed.lines !== "string")
      return null;
    return {
      path: parsed.path,
      threadId: parsed.threadId,
      basePath: parsed.basePath,
      lines: parsed.lines,
    };
  } catch {
    return null;
  }
}
