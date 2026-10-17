import type { DesignCanvasDocument } from "./canvas-types";
import { listDesignWorkflowStages } from "./canvas-workflow";

export function designStageRunPrompt(
  document: DesignCanvasDocument,
  nodeId: string,
): string {
  const stages = listDesignWorkflowStages(document);
  const target = stages.find((stage) => stage.nodeId === nodeId);
  const node = document.nodes.find((item) => item.id === nodeId);
  if (!target || !node) return designCanvasRunPrompt(document);
  const approved = stages
    .filter(
      (stage) => stage.status === "approved" || stage.status === "skipped",
    )
    .map((stage) => `${stage.id}(${stage.status})`)
    .join("、");
  const attempt =
    target.status === "running" ? target.attempt : target.attempt + 1;
  return `只执行创作画布「${document.title}」的当前阶段，不要重做其他已通过阶段。\n\n当前阶段：${target.id}\n稳定节点 ID：${target.nodeId}\n阶段目标：${node.title}：${node.description}\n本次尝试：${Math.max(1, attempt)}\n已锁定阶段：${approved || "无"}\n直接完成该阶段所需工作并给出可审核结果；需要修改剪辑、导演台或 ComfyUI 时调用对应的真实工具。不要虚构画布已被修改。`;
}

export function designCanvasRunPrompt(document: DesignCanvasDocument): string {
  const nodeSummary = document.nodes
    .filter(
      (node) =>
        node.kind !== "group" &&
        node.kind !== "sticker" &&
        node.kind !== "placeholder",
    )
    .map(
      (node, index) =>
        `${index + 1}. [${node.kind}] ${node.title}：${node.description}${node.binding ? `（绑定 ${node.binding.type}:${node.binding.id}）` : ""}${node.asset?.path ? `（工作区路径 ${node.asset.path}）` : ""}`,
    )
    .join("\n");
  const edgeSummary = document.edges
    .map((edge) => {
      const source = document.nodes.find((node) => node.id === edge.source);
      const target = document.nodes.find((node) => node.id === edge.target);
      return source && target ? `${source.title} → ${target.title}` : null;
    })
    .filter(Boolean)
    .join("；");
  return `请执行创作画布「${document.title}」。\n\n节点：\n${nodeSummary}\n\n编排关系：${edgeSummary || "按画布顺序执行"}\n\n请先给出执行计划，然后调用已绑定的角色、技能和插件逐步产出，并将结果作为项目交付物保存。`;
}
