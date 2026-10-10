/**
 * 项目页头部的「取消项目 / 删除项目」。
 *
 * 阻塞中的项目仍可恢复，后端拒绝直接删除；这里把 409 的原因翻成用户能照做的
 * 一句话，并给出出路（先取消项目）。只有真正的意外失败才提示「请重试」——
 * 对阻塞中的项目重试永远不会成功。
 */

import { BanIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { EchoAPIError } from "@/core/api/request";
import {
  type Project,
  useCancelProject,
  useDeleteProject,
} from "@/core/projects/hooks";

/** 还没完成、也没取消的项目才提供「取消项目」。 */
const CANCELLABLE_PROJECT_STATUSES = new Set([
  "planning",
  "running",
  "blocked",
]);

/** 409 冲突里后端给出的结构化原因（code + 项目状态）。 */
export function projectConflict(
  error: unknown,
): { code: string; status: string } | null {
  if (!(error instanceof EchoAPIError) || error.status !== 409) return null;
  const detail: unknown = error.detail;
  if (!detail || typeof detail !== "object") return null;
  const { code, status } = detail as { code?: unknown; status?: unknown };
  return {
    code: typeof code === "string" ? code : "",
    status: typeof status === "string" ? status : "",
  };
}

function deleteProjectFailure(error: unknown): {
  message: string;
  cancelSuggested: boolean;
} {
  const conflict = projectConflict(error);
  switch (conflict?.code) {
    case "PROJECT_ACTIVE":
      return {
        message:
          conflict.status === "blocked"
            ? "项目处于阻塞状态（仍可恢复），不能直接删除。请先取消项目，再删除。"
            : "项目正在执行，不能直接删除。请先取消项目，再删除。",
        cancelSuggested: true,
      };
    case "CLAIM_ACTIVE":
      return {
        message:
          "项目还有任务正在执行，暂时不能删除。请等待执行结束，或先取消项目再删除。",
        cancelSuggested: true,
      };
    case "PROJECT_DELETE_RECOVERY_PENDING":
      return {
        message: "项目删除尚未完成，请再次删除以完成清理。",
        cancelSuggested: false,
      };
    default:
      return { message: "删除项目失败，请重试", cancelSuggested: false };
  }
}

export function ProjectLifecycleActions({
  project,
  onDeleted,
  onChanged,
}: {
  project: Pick<Project, "id" | "name" | "status">;
  onDeleted: (projectId: string) => void;
  onChanged: () => void;
}) {
  const deleteProjectMutation = useDeleteProject();
  const cancelProjectMutation = useCancelProject();
  const { confirm, confirmDialog } = useConfirmDialog();
  const label = project.name || project.id;

  const handleCancelProject = async () => {
    const ok = await confirm({
      title: "取消项目",
      description: `确定要取消项目「${label}」吗？取消后项目将终止、不再继续执行，正在执行的任务结果会被作废，且不能恢复。取消后可以删除该项目。`,
      confirmLabel: "取消项目",
      cancelLabel: "返回",
      destructive: true,
    });
    if (!ok) return;

    try {
      await cancelProjectMutation.mutateAsync({ id: project.id });
      toast.success(`项目「${label}」已取消`);
      onChanged();
    } catch (error) {
      toast.error(
        projectConflict(error)?.code === "PROJECT_NOT_CANCELLABLE"
          ? "项目已完成，无需取消。"
          : "取消项目失败，请稍后重试。",
      );
    }
  };

  const handleDeleteProject = async () => {
    const ok = await confirm({
      title: "删除项目",
      description: `确定要移除项目「${label}」吗？相关数据与看板记录将被清理。`,
      confirmLabel: "删除",
      cancelLabel: "取消",
      destructive: true,
    });
    if (!ok) return;

    try {
      await deleteProjectMutation.mutateAsync(project.id);
      toast.success(`项目「${label}」已成功移除`);
      onDeleted(project.id);
    } catch (error) {
      const failure = deleteProjectFailure(error);
      if (failure.cancelSuggested) {
        toast.error(failure.message, {
          action: {
            label: "取消项目",
            onClick: () => void handleCancelProject(),
          },
        });
      } else {
        toast.error(failure.message);
      }
    }
  };

  return (
    <>
      {CANCELLABLE_PROJECT_STATUSES.has(project.status ?? "") && (
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 text-xs"
          disabled={cancelProjectMutation.isPending}
          onClick={() => void handleCancelProject()}
        >
          <BanIcon className="size-3.5" />
          取消项目
        </Button>
      )}
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/30"
        disabled={deleteProjectMutation.isPending}
        onClick={() => void handleDeleteProject()}
      >
        <Trash2Icon className="size-3.5" />
        删除项目
      </Button>
      {confirmDialog}
    </>
  );
}
