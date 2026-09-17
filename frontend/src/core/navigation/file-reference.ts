import { createContext } from "react";

export const FileReferenceScope = createContext<{
  threadId?: string;
  basePath?: string;
}>({});

export function parseFileReference(
  value: string,
): { path: string; lines?: string } | null {
  let path = value.trim();
  if (/^\/api\//i.test(path)) return null;
  try {
    path = decodeURIComponent(path);
  } catch {
    /* Keep literal malformed escapes. */
  }
  if (/^file:\/\/\//i.test(path))
    path = path.replace(
      /^file:\/\/\/(?:([a-z]:))?/i,
      (_, drive: string) => drive || "/",
    );
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path))
    return null;
  if (/^(?:\/\/|\\\\)|[\n\r\0<>?*|]/.test(path)) return null;
  const match = /^(.*?)(?::(\d+(?:-\d+)?)(?::\d+)?|#L(\d+(?:-L?\d+)?))?$/.exec(
    path,
  );
  if (!match?.[1]) return null;
  path = match[1];
  if (!/(?:^|[\\/])[^\\/]+\.[a-z0-9]{1,12}$/i.test(path)) return null;
  // Only path-like input or a filename, never a sentence/command made clickable.
  if (!/^[a-z]:[\\/]|^[./~]|[\\/]/i.test(path) && /\s/.test(path)) return null;
  return { path, lines: (match[2] || match[3])?.replace(/L/g, "") };
}

export function resolveFileReference(path: string, basePath?: string) {
  if (!basePath || /^(?:[a-z]:[\\/]|\/|~)/i.test(path)) return path;
  return `${basePath.replace(/[\\/]+$/, "")}/${path.replace(/^\.\//, "")}`;
}
