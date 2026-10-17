import type {
  DesignCanvasDocument,
  DesignCanvasMode,
  DesignCanvasTidyMode,
  DesignNodeKind,
} from "./canvas-types";

/** MiniMax keeps freeform exploration and executable workflow layouts apart.
 * The visible x/y pair is the active layout so existing renderers and persisted
 * v1 documents remain compatible; positions retains the inactive layout. */
export function switchDesignCanvasMode(
  document: DesignCanvasDocument,
  mode: DesignCanvasMode,
): DesignCanvasDocument {
  if (document.mode === mode) return document;
  return {
    ...document,
    mode,
    nodes: document.nodes.map((node) => {
      const positions = {
        ...node.positions,
        [document.mode]: { x: node.x, y: node.y },
      };
      const target = positions[mode] ?? { x: node.x, y: node.y };
      return { ...node, positions, x: target.x, y: target.y };
    }),
  };
}

export function tidyDesignCanvas(
  document: DesignCanvasDocument,
  mode: DesignCanvasTidyMode = "connections",
): DesignCanvasDocument {
  if (document.nodes.length === 0) return document;
  const groups = document.nodes.filter((node) => node.kind === "group");
  const stickers = document.nodes.filter((node) => node.kind === "sticker");
  if (groups.length > 0 || stickers.length > 0) {
    const tidied = tidyDesignCanvas(
      {
        ...document,
        nodes: document.nodes.filter(
          (node) => node.kind !== "group" && node.kind !== "sticker",
        ),
      },
      mode,
    );
    const reconciled = groups.map((group) => {
      const children = tidied.nodes.filter((node) =>
        group.childIds?.includes(node.id),
      );
      if (!children.length) return group;
      const minX = Math.min(...children.map((node) => node.x));
      const minY = Math.min(...children.map((node) => node.y));
      const maxX = Math.max(
        ...children.map((node) => node.x + (node.width ?? 236)),
      );
      const maxY = Math.max(
        ...children.map((node) => node.y + (node.height ?? 122)),
      );
      const x = minX - 24;
      const y = minY - 40;
      return {
        ...group,
        x,
        y,
        width: maxX - minX + 48,
        height: maxY - minY + 64,
        positions: {
          ...group.positions,
          [document.mode]: { x, y },
        },
      };
    });
    const movedStickers = stickers.map((sticker) => {
      if (!sticker.attachedTo) return sticker;
      const before = document.nodes.find(
        (node) => node.id === sticker.attachedTo,
      );
      const after = tidied.nodes.find((node) => node.id === sticker.attachedTo);
      if (!before || !after) return sticker;
      const x = sticker.x + after.x - before.x;
      const y = sticker.y + after.y - before.y;
      return {
        ...sticker,
        x,
        y,
        positions: {
          ...sticker.positions,
          [document.mode]: { x, y },
        },
      };
    });
    return {
      ...tidied,
      nodes: [...reconciled, ...movedStickers, ...tidied.nodes],
    };
  }
  const ordered = [...document.nodes];
  if (mode === "media") {
    const order: DesignNodeKind[] = [
      "text",
      "table",
      "image",
      "video",
      "audio",
      "file",
      "placeholder",
      "sticker",
      "group",
      "director",
      "editor",
      "comfyui",
      "agent",
      "skill",
      "plugin",
      "output",
    ];
    ordered.sort(
      (left, right) => order.indexOf(left.kind) - order.indexOf(right.kind),
    );
  }
  if (mode === "grid" || mode === "media") {
    const columns = Math.max(1, Math.ceil(Math.sqrt(ordered.length)));
    return {
      ...document,
      nodes: ordered.map((node, index) => ({
        ...node,
        x: 80 + (index % columns) * 320,
        y: 90 + Math.floor(index / columns) * 190,
      })),
    };
  }
  if (mode === "horizontal" || mode === "vertical") {
    return {
      ...document,
      nodes: ordered.map((node, index) => ({
        ...node,
        x: 80 + (mode === "horizontal" ? index * 320 : 0),
        y: 90 + (mode === "vertical" ? index * 190 : 0),
      })),
    };
  }
  const incoming = new Map<string, number>();
  document.nodes.forEach((node) => incoming.set(node.id, 0));
  document.edges.forEach((edge) =>
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1),
  );
  const level = new Map<string, number>();
  const queue = document.nodes
    .filter((node) => (incoming.get(node.id) ?? 0) === 0)
    .map((node) => node.id);
  queue.forEach((id) => level.set(id, 0));
  while (queue.length > 0) {
    const source = queue.shift()!;
    for (const edge of document.edges.filter(
      (item) => item.source === source,
    )) {
      const nextLevel = (level.get(source) ?? 0) + 1;
      level.set(edge.target, Math.max(level.get(edge.target) ?? 0, nextLevel));
      incoming.set(edge.target, (incoming.get(edge.target) ?? 1) - 1);
      if (incoming.get(edge.target) === 0) queue.push(edge.target);
    }
  }
  const rows = new Map<number, number>();
  return {
    ...document,
    nodes: document.nodes.map((node, index) => {
      const column = level.get(node.id) ?? index;
      const row = rows.get(column) ?? 0;
      rows.set(column, row + 1);
      return { ...node, x: 80 + column * 320, y: 90 + row * 190 };
    }),
  };
}

export function fitDesignMediaNodeDimensions(
  mediaWidth: number,
  mediaHeight: number,
): { width: number; height: number } {
  if (mediaWidth <= 0 || mediaHeight <= 0) return { width: 236, height: 240 };
  const aspect = mediaWidth / mediaHeight;
  const width = aspect <= 0.8 ? 190 : aspect >= 1.35 ? 260 : 220;
  const previewHeight = Math.round(Math.min(360, Math.max(96, width / aspect)));
  return { width, height: previewHeight + 25 };
}
