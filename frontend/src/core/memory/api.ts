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
import { looseBody } from "@/core/api/response";
import {
  isMemoryAssetList,
  isMemoryAssetTrace,
  isMemoryConfig,
  isMemoryData,
} from "./guards";

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
  return looseBody(
    await apiGet("/api/memory/assets", {
      query: params,
      errorMessage: failed("Failed to list memory assets"),
    }),
    isMemoryAssetList,
  );
}

export async function getMemoryAssetTrace(
  assetId: string,
): Promise<MemoryAssetTrace> {
  return looseBody(
    await apiGet("/api/memory/assets/{asset_id}/trace", {
      path: { asset_id: assetId },
      errorMessage: failed("Failed to load memory trace"),
    }),
    isMemoryAssetTrace,
  );
}

export async function getMemory(): Promise<MemoryData> {
  return looseBody(
    await apiGet("/api/memory", {
      errorMessage: failed("Failed to get memory"),
    }),
    isMemoryData,
  );
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
  return looseBody(
    await apiPost("/api/memory/reload", {
      errorMessage: failed("Failed to reload memory"),
    }),
    isMemoryData,
  );
}

export async function clearMemory(): Promise<MemoryData> {
  return looseBody(
    await apiDelete("/api/memory", {
      errorMessage: failed("Failed to clear memory"),
    }),
    isMemoryData,
  );
}

export async function createFact(
  request: FactCreateRequest,
): Promise<MemoryData> {
  return looseBody(
    await apiPost("/api/memory/facts", {
      body: request,
      errorMessage: detailOr("Failed to create fact"),
    }),
    isMemoryData,
  );
}

export const createMemoryFact = createFact;

export async function deleteFact(factId: string): Promise<MemoryData> {
  return looseBody(
    await apiDelete("/api/memory/facts/{fact_id}", {
      path: { fact_id: factId },
      errorMessage: failed("Failed to delete fact"),
    }),
    isMemoryData,
  );
}

export const deleteMemoryFact = deleteFact;

export async function updateFact(
  factId: string,
  request: FactPatchRequest,
): Promise<MemoryData> {
  return looseBody(
    await apiPatch("/api/memory/facts/{fact_id}", {
      path: { fact_id: factId },
      body: request,
      errorMessage: detailOr("Failed to update fact"),
    }),
    isMemoryData,
  );
}

export const updateMemoryFact = updateFact;

export async function getMemoryConfig(): Promise<MemoryConfig> {
  return looseBody(
    await apiGet("/api/memory/config", {
      errorMessage: failed("Failed to get memory config"),
    }),
    isMemoryConfig,
  );
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
  return looseBody(
    await apiGet("/api/memory/export", {
      errorMessage: failed("Failed to export memory"),
    }),
    isMemoryData,
  );
}

export async function importMemory(data: MemoryData): Promise<MemoryData> {
  return looseBody(
    await apiPost("/api/memory/import", {
      body: data,
      errorMessage: failed("Failed to import memory"),
    }),
    isMemoryData,
  );
}
