import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  failureDetail,
  untypedApi,
  type ApiFailure,
} from "@/core/api/request";

import type {
  FactCreateRequest,
  FactPatchRequest,
  MemoryConfig,
  MemoryConfigPatch,
  MemoryAssetList,
  MemoryAssetQuery,
  MemoryAssetTrace,
  MemoryData,
  MemorySearchResult,
} from "./types";

/** Keep this module's historical ``"<label>: <statusText>"`` wording. */
function failed(label: string) {
  return (failure: ApiFailure): string => `${label}: ${failure.statusText}`;
}

/** The body's ``detail`` when present, else ``"<label>: <statusText>"``. */
function detailOr(label: string) {
  return (failure: ApiFailure): string => {
    const detail = failureDetail(failure);
    return detail === undefined || detail === null
      ? `${label}: ${failure.statusText}`
      : String(detail);
  };
}

export async function listMemoryAssets(
  query: MemoryAssetQuery = {},
): Promise<MemoryAssetList> {
  // Empty strings mean "no filter" and are dropped like ``undefined``; the
  // caller's key order is kept.
  const params = Object.fromEntries(
    Object.entries(query).filter(
      ([, value]) => value !== undefined && value !== "",
    ),
  ) as MemoryAssetQuery;
  return (await apiGet("/api/memory/assets", {
    query: params,
    errorMessage: failed("Failed to list memory assets"),
  })) as MemoryAssetList;
}

export async function getMemoryAssetTrace(
  assetId: string,
): Promise<MemoryAssetTrace> {
  return (await apiGet("/api/memory/assets/{asset_id}/trace", {
    path: { asset_id: assetId },
    errorMessage: failed("Failed to load memory trace"),
  })) as MemoryAssetTrace;
}

export async function getMemory(): Promise<MemoryData> {
  return (await apiGet("/api/memory", {
    errorMessage: failed("Failed to get memory"),
  })) as MemoryData;
}

export const loadMemory = getMemory;

export async function searchMemory(
  query: string,
  limit = 20,
): Promise<MemorySearchResult[]> {
  return untypedApi.get<MemorySearchResult[]>("/api/memory/search", {
    reason: "the `limit` query param is not declared in the OpenAPI snapshot",
    query: { q: query, limit },
    errorMessage: failed("Failed to search memory"),
  });
}

export async function reloadMemory(): Promise<MemoryData> {
  return (await apiPost("/api/memory/reload", {
    errorMessage: failed("Failed to reload memory"),
  })) as MemoryData;
}

export async function clearMemory(): Promise<MemoryData> {
  return (await apiDelete("/api/memory", {
    errorMessage: failed("Failed to clear memory"),
  })) as MemoryData;
}

export async function createFact(
  request: FactCreateRequest,
): Promise<MemoryData> {
  return (await apiPost("/api/memory/facts", {
    body: request,
    errorMessage: detailOr("Failed to create fact"),
  })) as MemoryData;
}

export const createMemoryFact = createFact;

export async function deleteFact(factId: string): Promise<MemoryData> {
  return (await apiDelete("/api/memory/facts/{fact_id}", {
    path: { fact_id: factId },
    errorMessage: failed("Failed to delete fact"),
  })) as MemoryData;
}

export const deleteMemoryFact = deleteFact;

export async function updateFact(
  factId: string,
  request: FactPatchRequest,
): Promise<MemoryData> {
  return (await apiPatch("/api/memory/facts/{fact_id}", {
    path: { fact_id: factId },
    body: request,
    errorMessage: detailOr("Failed to update fact"),
  })) as MemoryData;
}

export const updateMemoryFact = updateFact;

export async function getMemoryConfig(): Promise<MemoryConfig> {
  return (await apiGet("/api/memory/config", {
    errorMessage: failed("Failed to get memory config"),
  })) as MemoryConfig;
}

export async function updateMemoryConfig(
  patch: MemoryConfigPatch,
): Promise<MemoryConfig> {
  return untypedApi.put<MemoryConfig>("/api/memory/config", {
    reason: "the snapshot declares no request body for PUT /api/memory/config",
    body: patch,
    errorMessage: failed("Failed to update memory config"),
  });
}

export async function exportMemory(): Promise<MemoryData> {
  return (await apiGet("/api/memory/export", {
    errorMessage: failed("Failed to export memory"),
  })) as MemoryData;
}

export async function importMemory(data: MemoryData): Promise<MemoryData> {
  return (await apiPost("/api/memory/import", {
    body: data,
    errorMessage: failed("Failed to import memory"),
  })) as MemoryData;
}
