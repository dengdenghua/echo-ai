import { authHeaders } from "@/core/auth/api";
import { ArtifactSaveError, canSaveWorkspaceOutput } from "./save";
import { urlOfArtifactRevision } from "./utils";

export interface ArtifactRevision {
  revision_id: string;
  created_at: number;
  bytes: number;
}

export interface ArtifactRevisionPage {
  revisions: ArtifactRevision[];
  next_cursor: string | null;
}

export interface ArtifactRevisionContent {
  revision_id: string;
  content: string;
  sha256: string;
}

type RevisionRequest = {
  filepath: string;
  threadId: string;
  signal?: AbortSignal;
};

async function readRevisions<T>(
  { filepath, threadId, signal }: RevisionRequest,
  params: Record<string, string>,
): Promise<T> {
  const address = urlOfArtifactRevision({ filepath, threadId });
  if (!address || !canSaveWorkspaceOutput(filepath)) {
    throw new ArtifactSaveError("该产物暂不支持版本历史。", 415);
  }
  const url = new URL(address, window.location.href);
  for (const [key, value] of Object.entries(params))
    url.searchParams.set(key, value);
  const response = await fetch(url.toString(), {
    headers: authHeaders(),
    signal,
  });
  if (!response.ok)
    throw new ArtifactSaveError(
      `无法读取版本历史（${response.status}），请重试。`,
      response.status,
    );
  return response.json() as Promise<T>;
}

export function listArtifactRevisions(
  request: RevisionRequest & { before?: string },
) {
  return readRevisions<ArtifactRevisionPage>(
    request,
    request.before ? { before: request.before } : {},
  );
}

export function readArtifactRevision(
  request: RevisionRequest & { revisionId: string },
) {
  return readRevisions<ArtifactRevisionContent>(request, {
    revision_id: request.revisionId,
  });
}
