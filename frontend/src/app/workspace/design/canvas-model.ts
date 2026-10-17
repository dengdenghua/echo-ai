import type {
  DesignCanvasDocument,
  DesignCanvasEdge,
  DesignCanvasNode,
  DesignStageStatus,
} from "./canvas-types";

// Every canvas type and operation stays importable from "./canvas-model".
export * from "./canvas-types";
export * from "./canvas-editing";
export * from "./canvas-layout";
export * from "./canvas-merge";
export * from "./canvas-prompts";
export * from "./canvas-workflow";

export const DESIGN_CANVAS_STORAGE_KEY = "echo:design-canvas:v1";

export const DEFAULT_DESIGN_CANVAS: DesignCanvasDocument = {
  version: 1,
  title: "品牌发布创作流",
  mode: "workflow",
  nodes: [
    {
      id: "brief",
      kind: "brief",
      title: "创作需求",
      description: "面向年轻用户，完成新品发布的视觉内容套件",
      x: 40,
      y: 160,
    },
    {
      id: "agent",
      kind: "agent",
      title: "视觉导演",
      description: "理解品牌与受众，拆解镜头、版式和内容节奏",
      x: 340,
      y: 80,
    },
    {
      id: "skill",
      kind: "skill",
      title: "图像生成技能",
      description: "生成主视觉、社媒配图与多尺寸变体",
      x: 340,
      y: 270,
    },
    {
      id: "output",
      kind: "output",
      title: "交付物",
      description: "海报 · 短视频 · 营销文案 · 发布清单",
      x: 660,
      y: 160,
    },
  ],
  edges: [
    { id: "brief-agent", source: "brief", target: "agent" },
    { id: "brief-skill", source: "brief", target: "skill" },
    { id: "agent-output", source: "agent", target: "output" },
    { id: "skill-output", source: "skill", target: "output" },
  ],
};

export function parseDesignCanvas(value: string | null): DesignCanvasDocument {
  if (!value) return structuredClone(DEFAULT_DESIGN_CANVAS);
  try {
    const parsed = JSON.parse(value) as Partial<DesignCanvasDocument>;
    if (
      parsed.version !== 1 ||
      !Array.isArray(parsed.nodes) ||
      !Array.isArray(parsed.edges)
    ) {
      return structuredClone(DEFAULT_DESIGN_CANVAS);
    }
    return {
      version: 1,
      title:
        typeof parsed.title === "string" && parsed.title.trim()
          ? parsed.title
          : DEFAULT_DESIGN_CANVAS.title,
      mode: parsed.mode === "freeform" ? "freeform" : "workflow",
      nodes: parsed.nodes.filter(isDesignCanvasNode).map((node) => ({
        ...node,
        stage: isDesignStage(node.stage) ? node.stage : undefined,
      })),
      edges: parsed.edges.filter(isDesignCanvasEdge),
    };
  } catch {
    return structuredClone(DEFAULT_DESIGN_CANVAS);
  }
}

const DESIGN_STAGE_STATUSES = new Set<DesignStageStatus>([
  "pending",
  "running",
  "review",
  "approved",
  "failed",
  "skipped",
]);

function isDesignStage(
  value: unknown,
): value is NonNullable<DesignCanvasNode["stage"]> {
  if (!value || typeof value !== "object") return false;
  const stage = value as Partial<NonNullable<DesignCanvasNode["stage"]>>;
  return (
    typeof stage.id === "string" &&
    stage.id.length > 0 &&
    stage.id.length <= 160 &&
    typeof stage.order === "number" &&
    Number.isInteger(stage.order) &&
    stage.order >= 0 &&
    typeof stage.attempt === "number" &&
    Number.isInteger(stage.attempt) &&
    stage.attempt >= 0 &&
    typeof stage.status === "string" &&
    DESIGN_STAGE_STATUSES.has(stage.status)
  );
}

function isDesignCanvasNode(value: unknown): value is DesignCanvasNode {
  if (!value || typeof value !== "object") return false;
  const node = value as Partial<DesignCanvasNode>;
  return (
    typeof node.id === "string" &&
    typeof node.kind === "string" &&
    typeof node.title === "string" &&
    typeof node.description === "string" &&
    typeof node.x === "number" &&
    Number.isFinite(node.x) &&
    typeof node.y === "number" &&
    Number.isFinite(node.y)
  );
}

function isDesignCanvasEdge(value: unknown): value is DesignCanvasEdge {
  if (!value || typeof value !== "object") return false;
  const edge = value as Partial<DesignCanvasEdge>;
  return (
    typeof edge.id === "string" &&
    typeof edge.source === "string" &&
    typeof edge.target === "string"
  );
}
