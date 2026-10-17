import type {
  DesignCanvasClipboard,
  DesignCanvasDeletionPlan,
  DesignCanvasDocument,
  DesignCanvasNode,
} from "./canvas-types";

export function appendDesignNode(
  document: DesignCanvasDocument,
  node: DesignCanvasNode,
  sourceId?: string | null,
): DesignCanvasDocument {
  const source = sourceId
    ? document.nodes.find((item) => item.id === sourceId)
    : undefined;
  const edges = source
    ? [
        ...document.edges,
        {
          id: `${source.id}-${node.id}`,
          source: source.id,
          target: node.id,
        },
      ]
    : document.edges;
  return { ...document, nodes: [...document.nodes, node], edges };
}

export function connectDesignNodes(
  document: DesignCanvasDocument,
  sourceId: string,
  targetId: string,
): DesignCanvasDocument {
  if (sourceId === targetId) return document;
  const source = document.nodes.find((node) => node.id === sourceId);
  const target = document.nodes.find((node) => node.id === targetId);
  if (!source || !target) return document;
  if (
    source.kind === "group" ||
    source.kind === "sticker" ||
    source.kind === "placeholder" ||
    target.kind === "group" ||
    target.kind === "sticker" ||
    target.kind === "placeholder"
  )
    return document;
  if (
    document.edges.some(
      (edge) => edge.source === sourceId && edge.target === targetId,
    )
  )
    return document;
  const reachable = new Set<string>([targetId]);
  const queue = [targetId];
  while (queue.length) {
    const current = queue.shift()!;
    for (const edge of document.edges) {
      if (edge.source !== current || reachable.has(edge.target)) continue;
      reachable.add(edge.target);
      queue.push(edge.target);
    }
  }
  if (reachable.has(sourceId)) return document;
  return {
    ...document,
    edges: [
      ...document.edges,
      {
        id: `${sourceId}-${targetId}-${Date.now().toString(36)}`,
        source: sourceId,
        target: targetId,
      },
    ],
  };
}

export function disconnectDesignEdge(
  document: DesignCanvasDocument,
  edgeId: string,
): DesignCanvasDocument {
  return {
    ...document,
    edges: document.edges.filter((edge) => edge.id !== edgeId),
  };
}

const HIGH_BLAST_DELETE_MIN_ELEMENTS = 10;
const HIGH_BLAST_DELETE_REMAINING_RATIO = 0.5;

function isHighBlastDeletion(currentCount: number, incomingCount: number) {
  return (
    currentCount >= HIGH_BLAST_DELETE_MIN_ELEMENTS &&
    incomingCount < currentCount * HIGH_BLAST_DELETE_REMAINING_RATIO
  );
}

export function planDesignSelectionDeletion(
  document: DesignCanvasDocument,
  nodeIds: string[],
): DesignCanvasDeletionPlan {
  const removing = new Set(nodeIds);
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const node of document.nodes) {
      if (node.kind === "group" && removing.has(node.id)) {
        for (const childId of node.childIds ?? []) {
          if (!removing.has(childId)) {
            removing.add(childId);
            expanded = true;
          }
        }
      }
      if (
        node.kind === "sticker" &&
        node.attachedTo &&
        removing.has(node.attachedTo) &&
        !removing.has(node.id)
      ) {
        removing.add(node.id);
        expanded = true;
      }
    }
  }
  const edgeIds = document.edges
    .filter((edge) => removing.has(edge.source) || removing.has(edge.target))
    .map((edge) => edge.id);
  return {
    nodeIds: Array.from(removing),
    edgeIds,
    highBlast:
      isHighBlastDeletion(
        document.nodes.length,
        document.nodes.length - removing.size,
      ) ||
      isHighBlastDeletion(
        document.edges.length,
        document.edges.length - edgeIds.length,
      ),
  };
}

export function deleteDesignSelection(
  document: DesignCanvasDocument,
  nodeIds: string[],
): DesignCanvasDocument {
  const plan = planDesignSelectionDeletion(document, nodeIds);
  const removing = new Set(plan.nodeIds);
  return {
    ...document,
    nodes: document.nodes
      .filter((node) => !removing.has(node.id))
      .map((node) =>
        node.kind === "group"
          ? {
              ...node,
              childIds: (node.childIds ?? []).filter(
                (childId) => !removing.has(childId),
              ),
            }
          : node,
      ),
    edges: document.edges.filter(
      (edge) => !removing.has(edge.source) && !removing.has(edge.target),
    ),
  };
}

export function copyDesignSelection(
  document: DesignCanvasDocument,
  nodeIds: string[],
): DesignCanvasClipboard {
  const selected = new Set(nodeIds);
  document.nodes.forEach((node) => {
    if (node.kind === "group" && selected.has(node.id))
      node.childIds?.forEach((id) => selected.add(id));
  });
  document.nodes.forEach((node) => {
    if (
      node.kind === "sticker" &&
      node.attachedTo &&
      selected.has(node.attachedTo)
    )
      selected.add(node.id);
  });
  return {
    nodes: document.nodes
      .filter((node) => selected.has(node.id))
      .map((node) => structuredClone(node)),
    edges: document.edges
      .filter((edge) => selected.has(edge.source) && selected.has(edge.target))
      .map((edge) => structuredClone(edge)),
    inheritedEdges: document.edges
      .filter((edge) => !selected.has(edge.source) && selected.has(edge.target))
      .map((edge) => structuredClone(edge)),
  };
}

export function pasteDesignSelection(
  document: DesignCanvasDocument,
  clipboard: DesignCanvasClipboard,
  suffix: string,
  offset = 32,
  targetCenter?: { x: number; y: number },
): { document: DesignCanvasDocument; nodeIds: string[] } {
  if (!clipboard.nodes.length) return { document, nodeIds: [] };
  const visibleNodes = clipboard.nodes.filter(
    (node) => node.kind !== "sticker",
  );
  const boundsNodes = visibleNodes.length ? visibleNodes : clipboard.nodes;
  const minX = Math.min(...boundsNodes.map((node) => node.x));
  const minY = Math.min(...boundsNodes.map((node) => node.y));
  const maxX = Math.max(
    ...boundsNodes.map((node) => node.x + (node.width ?? 236)),
  );
  const maxY = Math.max(
    ...boundsNodes.map((node) => node.y + (node.height ?? 132)),
  );
  const shiftX = targetCenter ? targetCenter.x - (minX + maxX) / 2 : offset;
  const shiftY = targetCenter ? targetCenter.y - (minY + maxY) / 2 : offset;
  const ids = new Map(
    clipboard.nodes.map((node) => [node.id, `${node.id}-copy-${suffix}`]),
  );
  const nextComfyOrdinal = new Map<string, number>();
  for (const node of document.nodes) {
    if (node.kind !== "comfyui" || node.binding?.type !== "workflow") continue;
    nextComfyOrdinal.set(
      node.binding.id,
      Math.max(
        nextComfyOrdinal.get(node.binding.id) ?? 0,
        node.copyOrdinal ?? 0,
      ),
    );
  }
  const nodes = clipboard.nodes.map((node) => {
    const x = node.x + shiftX;
    const y = node.y + shiftY;
    const positions = node.positions
      ? Object.fromEntries(
          Object.entries(node.positions).map(([mode, position]) => [
            mode,
            position
              ? { x: position.x + shiftX, y: position.y + shiftY }
              : position,
          ]),
        )
      : undefined;
    const comfyWorkflowId =
      node.kind === "comfyui" && node.binding?.type === "workflow"
        ? node.binding.id
        : null;
    const copyOrdinal = comfyWorkflowId
      ? (nextComfyOrdinal.get(comfyWorkflowId) ?? 0) + 1
      : undefined;
    if (comfyWorkflowId && copyOrdinal)
      nextComfyOrdinal.set(comfyWorkflowId, copyOrdinal);
    const baseTitle = node.copyOrdinal
      ? node.title.replace(/ 副本 \d+$/, "")
      : node.title;
    return {
      ...structuredClone(node),
      id: ids.get(node.id)!,
      title: copyOrdinal
        ? `${baseTitle} 副本 ${copyOrdinal}`
        : node.kind === "group" || node.kind === "sticker"
          ? node.title
          : `${node.title} 副本`,
      copyOrdinal,
      x,
      y,
      positions,
      childIds: node.childIds
        ?.map((id) => ids.get(id))
        .filter((id): id is string => Boolean(id)),
      attachedTo: node.attachedTo ? ids.get(node.attachedTo) : undefined,
    } satisfies DesignCanvasNode;
  });
  const edges = [
    ...clipboard.edges,
    ...(clipboard.inheritedEdges ?? []),
  ].flatMap((edge, index) => {
    const source = ids.get(edge.source) ?? edge.source;
    const target = ids.get(edge.target);
    return source && target
      ? [
          {
            ...structuredClone(edge),
            id: `${source}-${target}-${suffix}-${index}`,
            source,
            target,
          },
        ]
      : [];
  });
  return {
    document: {
      ...document,
      nodes: [...document.nodes, ...nodes],
      edges: [...document.edges, ...edges],
    },
    nodeIds: nodes.map((node) => node.id),
  };
}

export function groupDesignNodes(
  document: DesignCanvasDocument,
  nodeIds: string[],
  groupId: string,
): DesignCanvasDocument {
  const selected = document.nodes.filter(
    (node) => nodeIds.includes(node.id) && node.kind !== "group",
  );
  if (selected.length < 2) return document;
  const minX = Math.min(...selected.map((node) => node.x));
  const minY = Math.min(...selected.map((node) => node.y));
  const maxX = Math.max(
    ...selected.map((node) => node.x + (node.width ?? 236)),
  );
  const maxY = Math.max(
    ...selected.map((node) => node.y + (node.height ?? 122)),
  );
  const group: DesignCanvasNode = {
    id: groupId,
    kind: "group",
    title: "节点组",
    description: `${selected.length} 个节点`,
    childIds: selected.map((node) => node.id),
    color: "purple",
    x: minX - 24,
    y: minY - 40,
    width: maxX - minX + 48,
    height: maxY - minY + 64,
    positions: {
      [document.mode]: { x: minX - 24, y: minY - 40 },
    },
  };
  return { ...document, nodes: [group, ...document.nodes] };
}

export function ungroupDesignNode(
  document: DesignCanvasDocument,
  groupId: string,
): DesignCanvasDocument {
  const group = document.nodes.find(
    (node) => node.id === groupId && node.kind === "group",
  );
  if (!group) return document;
  return {
    ...document,
    nodes: document.nodes.filter((node) => node.id !== groupId),
    edges: document.edges.filter(
      (edge) => edge.source !== groupId && edge.target !== groupId,
    ),
  };
}
