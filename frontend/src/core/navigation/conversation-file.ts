import { getBackendBaseURL } from "@/core/config";
import {
  normalizeWorkspaceArtifactRef,
  parseWorkspaceOutputRef,
  resolveArtifactURL,
  urlOfArtifact,
} from "@/core/artifacts/utils";
import { parseFileReference, resolveFileReference } from "./file-reference";

export function fileReferenceParams(
  path: string,
  threadId?: string,
  reference?: string,
) {
  const params = new URLSearchParams({ path });
  if (threadId) params.set("thread_id", threadId);
  if (reference && !/^(?:[a-z]:[\\/]|\/|~)/i.test(reference))
    params.set("reference", reference);
  return params;
}

/** All conversation image renderers use the same scoped, authenticated route. */
export function conversationImageURL(
  src: string,
  threadId?: string,
  basePath?: string,
) {
  if (/^(?:https?:|data:|blob:|\/\/|\/api\/)/i.test(src)) return src;
  const path = parseFileReference(src)?.path ?? src;
  const ref = normalizeWorkspaceArtifactRef(path, threadId);
  if (threadId && parseWorkspaceOutputRef(ref))
    return urlOfArtifact({ filepath: ref, threadId });
  if (threadId && path.startsWith("/mnt/"))
    return resolveArtifactURL(path, threadId);
  if (!parseFileReference(path)) return src;
  return `${getBackendBaseURL()}/api/fs/preview?${fileReferenceParams(resolveFileReference(path, basePath), threadId, path)}`;
}
