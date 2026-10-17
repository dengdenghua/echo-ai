import type {
  DesignCanvasDocument,
  DesignCanvasNode,
  DesignStageStatus,
  DesignWorkflowStageSummary,
} from "./canvas-types";

/** Original, provider-neutral drama workflow. The stages mirror a real
 * production dependency chain without copying any vendor prompt or asset. */
export function createDramaSeriesCanvas(): DesignCanvasDocument {
  const stages: Array<
    Omit<DesignCanvasNode, "stage"> & {
      stage: NonNullable<DesignCanvasNode["stage"]>;
    }
  > = [
    {
      id: "drama-script",
      kind: "text",
      title: "01 剧本与集数范围",
      description:
        "确认目标集、时长、对白和事实边界；有原剧本时只做结构化，不擅自改写。",
      x: 60,
      y: 150,
      binding: { type: "skill", id: "creative-microdrama-writer" },
      stage: {
        id: "script",
        order: 1,
        status: "pending",
        attempt: 0,
        reviewRequired: true,
      },
    },
    {
      id: "drama-production-plan",
      kind: "table",
      title: "02 制作方案",
      description:
        "锁定真人/漫剧、时代地域、画幅、语言、风格、模型和声音方案。",
      x: 360,
      y: 150,
      stage: {
        id: "production-plan",
        order: 2,
        status: "pending",
        attempt: 0,
        reviewRequired: true,
      },
    },
    {
      id: "drama-asset-anchors",
      kind: "image",
      title: "03 角色与场景锚点",
      description:
        "建立角色脸型、体态、服装、道具和场景多角度参考，作为连续性基准。",
      x: 660,
      y: 150,
      binding: { type: "skill", id: "creative-multi-angle-render" },
      stage: {
        id: "asset-anchors",
        order: 3,
        status: "pending",
        attempt: 0,
        reviewRequired: true,
      },
    },
    {
      id: "drama-storyboard",
      kind: "image",
      title: "04 分镜与站位",
      description:
        "按对白和动作计算镜头时长，记录人物站位、视线与轴线；单镜头组不超过 15 秒。",
      x: 960,
      y: 150,
      binding: { type: "skill", id: "creative-storyboard-assets" },
      stage: {
        id: "storyboard",
        order: 4,
        status: "pending",
        attempt: 0,
        reviewRequired: true,
      },
    },
    {
      id: "drama-keyframes",
      kind: "director",
      title: "05 场景关键帧",
      description: "在导演台复核构图、角色 blocking、机位和动作连续性。",
      x: 1260,
      y: 150,
      binding: { type: "plugin", id: "director-stage" },
      stage: {
        id: "keyframes",
        order: 5,
        status: "pending",
        attempt: 0,
        reviewRequired: true,
      },
    },
    {
      id: "drama-visual-generation",
      kind: "comfyui",
      title: "06 镜头生成",
      description: "按已通过的锚点与关键帧逐镜生成；失败时只重跑对应镜头。",
      x: 1560,
      y: 150,
      stage: {
        id: "visual-generation",
        order: 6,
        status: "pending",
        attempt: 0,
        reviewRequired: true,
      },
    },
    {
      id: "drama-post",
      kind: "editor",
      title: "07 剪辑与交付",
      description:
        "完成节奏、配音、字幕、音乐、转场和导出，并以真实快照/成片复核。",
      x: 1860,
      y: 150,
      binding: { type: "plugin", id: "clip-studio" },
      stage: {
        id: "post",
        order: 7,
        status: "pending",
        attempt: 0,
        reviewRequired: true,
      },
    },
  ];
  const output: DesignCanvasNode = {
    id: "drama-delivery",
    kind: "output",
    title: "剧集交付",
    description: "已审核的剧本、资产锚点、分镜、镜头和最终成片。",
    x: 2160,
    y: 150,
  };
  const nodes: DesignCanvasNode[] = [...stages, output];
  return {
    version: 1,
    title: "AI 漫剧制作流",
    mode: "workflow",
    nodes,
    edges: nodes.slice(0, -1).map((node, index) => ({
      id: `${node.id}-${nodes[index + 1]!.id}`,
      source: node.id,
      target: nodes[index + 1]!.id,
    })),
  };
}

export function listDesignWorkflowStages(
  document: DesignCanvasDocument,
): DesignWorkflowStageSummary[] {
  const stageByNodeId = new Map(
    document.nodes
      .filter((node) => node.stage)
      .map((node) => [node.id, node.stage!.id]),
  );
  return document.nodes
    .filter(
      (
        node,
      ): node is DesignCanvasNode & {
        stage: NonNullable<DesignCanvasNode["stage"]>;
      } => Boolean(node.stage),
    )
    .map((node) => ({
      id: node.stage.id,
      nodeId: node.id,
      title: node.title,
      order: node.stage.order,
      status: node.stage.status,
      attempt: node.stage.attempt,
      reviewRequired: node.stage.reviewRequired !== false,
      dependencies: document.edges
        .filter((edge) => edge.target === node.id)
        .map((edge) => stageByNodeId.get(edge.source))
        .filter((id): id is string => Boolean(id)),
    }))
    .sort((left, right) => left.order - right.order);
}

export function designStageBlockers(
  document: DesignCanvasDocument,
  nodeId: string,
): DesignWorkflowStageSummary[] {
  const stages = listDesignWorkflowStages(document);
  const target = stages.find((stage) => stage.nodeId === nodeId);
  if (!target) return [];
  const byId = new Map(stages.map((stage) => [stage.id, stage]));
  return target.dependencies
    .map((id) => byId.get(id))
    .filter(
      (stage): stage is DesignWorkflowStageSummary =>
        Boolean(stage) &&
        stage!.status !== "approved" &&
        stage!.status !== "skipped",
    );
}

export function setDesignStageStatus(
  document: DesignCanvasDocument,
  nodeId: string,
  status: DesignStageStatus,
  options?: { error?: string; incrementAttempt?: boolean },
): DesignCanvasDocument {
  let changed = false;
  const updatedAt = new Date().toISOString();
  const nodes = document.nodes.map((node) => {
    if (node.id !== nodeId || !node.stage) return node;
    changed = true;
    return {
      ...node,
      stage: {
        ...node.stage,
        status,
        attempt:
          node.stage.attempt + (options?.incrementAttempt === true ? 1 : 0),
        updatedAt,
        lastError: options?.error,
      },
    };
  });
  return changed ? { ...document, nodes } : document;
}

/** Start or retry one stage. Accepted upstream work stays locked while every
 * downstream stage becomes pending because its inputs may have changed. */
export function beginDesignStage(
  document: DesignCanvasDocument,
  nodeId: string,
): DesignCanvasDocument {
  if (designStageBlockers(document, nodeId).length > 0) return document;
  const downstream = new Set<string>();
  const queue = [nodeId];
  while (queue.length > 0) {
    const source = queue.shift()!;
    for (const edge of document.edges) {
      if (edge.source !== source || downstream.has(edge.target)) continue;
      downstream.add(edge.target);
      queue.push(edge.target);
    }
  }
  const updatedAt = new Date().toISOString();
  return {
    ...document,
    nodes: document.nodes.map((node) => {
      if (!node.stage) return node;
      if (node.id === nodeId) {
        return {
          ...node,
          stage: {
            ...node.stage,
            status: "running",
            attempt: node.stage.attempt + 1,
            updatedAt,
            lastError: undefined,
          },
        };
      }
      if (!downstream.has(node.id)) return node;
      return {
        ...node,
        stage: {
          ...node.stage,
          status: "pending",
          updatedAt,
          lastError: undefined,
        },
      };
    }),
  };
}
