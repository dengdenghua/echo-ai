import { EchoAPIError, failureDetail, untypedApi } from "@/core/api/request";

import {
  parseWorkspaceOutputRef,
  urlOfArtifact,
  urlOfArtifactRevision,
} from "./utils";

export type ArtifactSaveResult = {
  success: boolean;
  path: string;
  bytes: number;
  sha256: string;
  revision_id?: string | null;
};

export class ArtifactSaveError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ArtifactSaveError";
    this.status = status;
  }
}

/**
 * PUT/POST a scoped workspace output. A string ``detail`` (or
 * ``detail.message``) becomes the error text, else ``"<fallback> (HTTP n)."``;
 * every HTTP failure surfaces as ``ArtifactSaveError``.
 */
async function writeOutput(
  method: "put" | "post",
  url: string,
  body: object,
  fallback: string,
): Promise<ArtifactSaveResult> {
  try {
    return await untypedApi[method]<ArtifactSaveResult>(url, {
      reason:
        "the caller resolves the full URL; artifact_path keeps its '/' separators unencoded",
      baseUrl: "",
      body,
      errorMessage: (failure) => {
        const detail = failureDetail(failure) as
          | string
          | { message?: unknown }
          | null
          | undefined;
        return typeof detail === "string"
          ? detail
          : typeof detail?.message === "string"
            ? detail.message
            : `${fallback} (HTTP ${failure.status}).`;
      },
    });
  } catch (error) {
    if (error instanceof EchoAPIError) {
      throw new ArtifactSaveError(error.message, error.status);
    }
    throw error;
  }
}

export async function sha256Text(content: string): Promise<string | undefined> {
  if (!globalThis.crypto?.subtle) return undefined;
  const bytes = new TextEncoder().encode(content);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function canSaveWorkspaceOutput(filepath: string): boolean {
  const parsed = parseWorkspaceOutputRef(filepath);
  return Boolean(parsed && /\.html?$/i.test(parsed.relativePath));
}

export async function saveWorkspaceOutputContent({
  filepath,
  threadId,
  content,
  expectedContent,
}: {
  filepath: string;
  threadId: string;
  content: string;
  expectedContent: string;
}): Promise<ArtifactSaveResult> {
  if (!canSaveWorkspaceOutput(filepath)) {
    throw new ArtifactSaveError(
      "This artifact is not an editable HTML workspace output.",
      415,
    );
  }
  const expectedSha256 = await sha256Text(expectedContent);
  if (!expectedSha256) {
    throw new ArtifactSaveError(
      "Secure content verification is unavailable in this browser.",
      0,
    );
  }
  return writeOutput(
    "put",
    urlOfArtifact({ filepath, threadId }),
    { content, expected_sha256: expectedSha256 },
    "Failed to save artifact",
  );
}

export async function restoreWorkspaceOutputRevision({
  filepath,
  threadId,
  revisionId,
  expectedContent,
}: {
  filepath: string;
  threadId: string;
  revisionId: string;
  expectedContent: string;
}): Promise<ArtifactSaveResult> {
  const url = urlOfArtifactRevision({ filepath, threadId });
  if (!url || !canSaveWorkspaceOutput(filepath)) {
    throw new ArtifactSaveError(
      "This artifact is not an editable HTML workspace output.",
      415,
    );
  }
  const expectedSha256 = await sha256Text(expectedContent);
  if (!expectedSha256) {
    throw new ArtifactSaveError(
      "Secure content verification is unavailable in this browser.",
      0,
    );
  }
  return writeOutput(
    "post",
    url,
    { revision_id: revisionId, expected_sha256: expectedSha256 },
    "Failed to restore artifact",
  );
}
