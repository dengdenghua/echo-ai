import {
  apiGet,
  apiPost,
  failureDetail,
  untypedApi,
  type ApiFailure,
} from "@/core/api/request";

import type {
  WikiDocList,
  WikiDocument,
  WikiStatus,
  WikiUpdateResult,
} from "./types";

/** ``detail`` from the error body, else this module's status wording. */
function failed(failure: ApiFailure): string {
  const detail = failureDetail(failure);
  return detail === undefined || detail === null
    ? `Wiki request failed (${failure.status})`
    : String(detail);
}

export async function getWikiStatus(root?: string | null): Promise<WikiStatus> {
  return (await apiGet("/api/wiki/status", {
    query: { root: root || undefined },
    errorMessage: failed,
  })) as WikiStatus;
}

export async function listWikiDocs(root?: string | null): Promise<WikiDocList> {
  return (await apiGet("/api/wiki/docs", {
    query: { lang: "zh", root: root || undefined },
    errorMessage: failed,
  })) as WikiDocList;
}

export function getWikiDocument(
  path: string,
  root?: string | null,
): Promise<WikiDocument> {
  const safePath = path.split("/").map(encodeURIComponent).join("/");
  return untypedApi.get<WikiDocument>(`/api/wiki/docs/${safePath}`, {
    reason:
      "doc_path is a multi-segment path; its '/' separators must stay unencoded",
    query: { root: root || undefined },
    errorMessage: failed,
  });
}

export async function generateWiki(
  root?: string | null,
): Promise<WikiUpdateResult> {
  return (await apiPost("/api/wiki/generate", {
    query: { root: root || undefined },
    errorMessage: failed,
  })) as WikiUpdateResult;
}

export async function updateWiki(
  root?: string | null,
): Promise<WikiUpdateResult> {
  return (await apiPost("/api/wiki/update", {
    query: { root: root || undefined },
    errorMessage: failed,
  })) as WikiUpdateResult;
}
