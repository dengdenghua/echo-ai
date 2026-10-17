export type DesignCanvasMode = "freeform" | "workflow";
export type DesignStageStatus =
  | "pending"
  | "running"
  | "review"
  | "approved"
  | "failed"
  | "skipped";
export type DesignNodeKind =
  | "brief"
  | "agent"
  | "skill"
  | "plugin"
  | "frame"
  | "component"
  | "token"
  | "preview"
  | "text"
  | "table"
  | "image"
  | "video"
  | "audio"
  | "file"
  | "placeholder"
  | "group"
  | "sticker"
  | "director"
  | "editor"
  | "comfyui"
  | "output";

export interface DesignCanvasNode {
  id: string;
  kind: DesignNodeKind;
  title: string;
  description: string;
  x: number;
  y: number;
  positions?: Partial<Record<DesignCanvasMode, { x: number; y: number }>>;
  childIds?: string[];
  color?: string;
  emoji?: string;
  attachedTo?: string;
  copyOrdinal?: number;
  tags?: string[];
  width?: number;
  height?: number;
  binding?: {
    type: "agent" | "skill" | "plugin" | "workflow" | "asset";
    id: string;
  };
  asset?: {
    id: string;
    kind: string;
    path?: string;
    url?: string;
    projectId?: string;
    source?: string;
  };
  /** Durable provenance for content returned by the embedded Design agent. */
  origin?: {
    type: "agent-result";
    threadId: string;
    messageId: string;
  };
  /** Stable execution identity and review state for workflow-stage nodes. */
  stage?: {
    id: string;
    order: number;
    status: DesignStageStatus;
    attempt: number;
    reviewRequired?: boolean;
    updatedAt?: string;
    lastError?: string;
  };
}

export interface DesignCanvasEdge {
  id: string;
  source: string;
  target: string;
}

export interface DesignCanvasDocument {
  version: 1;
  title: string;
  mode: DesignCanvasMode;
  nodes: DesignCanvasNode[];
  edges: DesignCanvasEdge[];
}

export interface DesignCanvasClipboard {
  nodes: DesignCanvasNode[];
  edges: DesignCanvasEdge[];
  inheritedEdges?: DesignCanvasEdge[];
}

export interface DesignCanvasDeletionPlan {
  nodeIds: string[];
  edgeIds: string[];
  highBlast: boolean;
}

export interface DesignCanvasMergeResult {
  document: DesignCanvasDocument;
  conflicts: string[];
}

export interface DesignWorkflowStageSummary {
  id: string;
  nodeId: string;
  title: string;
  order: number;
  status: DesignStageStatus;
  attempt: number;
  reviewRequired: boolean;
  dependencies: string[];
}

export type DesignCanvasTidyMode =
  | "connections"
  | "media"
  | "grid"
  | "horizontal"
  | "vertical";
