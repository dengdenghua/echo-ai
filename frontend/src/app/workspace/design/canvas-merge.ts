import type {
  DesignCanvasDocument,
  DesignCanvasMergeResult,
} from "./canvas-types";

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function mergeValue<T>(
  label: string,
  base: T | undefined,
  local: T | undefined,
  remote: T | undefined,
  conflicts: string[],
): T | undefined {
  if (sameValue(local, remote)) return local;
  if (sameValue(local, base)) return remote;
  if (sameValue(remote, base)) return local;
  conflicts.push(label);
  // A conflict is never written automatically. Keeping the local version in
  // the preview lets the member explicitly choose "merge and save" later.
  return local;
}

function mergeEntities<T extends { id: string }>(
  label: string,
  base: T[],
  local: T[],
  remote: T[],
  conflicts: string[],
): T[] {
  const baseById = new Map(base.map((item) => [item.id, item]));
  const localById = new Map(local.map((item) => [item.id, item]));
  const remoteById = new Map(remote.map((item) => [item.id, item]));
  const ids = [
    ...local.map((item) => item.id),
    ...remote.map((item) => item.id).filter((id) => !localById.has(id)),
    ...base
      .map((item) => item.id)
      .filter((id) => !localById.has(id) && !remoteById.has(id)),
  ];
  return ids.flatMap((id) => {
    const merged = mergeValue(
      `${label}:${id}`,
      baseById.get(id),
      localById.get(id),
      remoteById.get(id),
      conflicts,
    );
    return merged ? [merged] : [];
  });
}

/** Three-way merge for project canvases. Disjoint node/edge edits merge
 * automatically; edits to the same entity are reported for explicit review. */
export function mergeDesignCanvases(
  base: DesignCanvasDocument,
  local: DesignCanvasDocument,
  remote: DesignCanvasDocument,
): DesignCanvasMergeResult {
  const conflicts: string[] = [];
  return {
    document: {
      version: 1,
      title:
        mergeValue("title", base.title, local.title, remote.title, conflicts) ??
        local.title,
      mode:
        mergeValue("mode", base.mode, local.mode, remote.mode, conflicts) ??
        local.mode,
      nodes: mergeEntities(
        "node",
        base.nodes,
        local.nodes,
        remote.nodes,
        conflicts,
      ),
      edges: mergeEntities(
        "edge",
        base.edges,
        local.edges,
        remote.edges,
        conflicts,
      ),
    },
    conflicts,
  };
}
