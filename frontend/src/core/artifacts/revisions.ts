import { EchoAPIError, untypedApi } from "@/core/api/request";
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
  try {
    return await untypedApi.get<T>(url.toString(), {
      reason:
        "the URL is derived from urlOfArtifactRevision; artifact_path keeps its '/' separators unencoded",
      baseUrl: "",
      signal,
    });
  } catch (error) {
    if (error instanceof EchoAPIError) {
      throw new ArtifactSaveError(
        `无法读取版本历史（${error.status}），请重试。`,
        error.status,
      );
    }
    throw error;
  }
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
