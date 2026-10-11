import { Button } from "@/components/ui/button";
import type { ProjectExecution } from "./use-project-execution";

const labels: Record<string, string> = {
  queued: "排队中",
  pending: "排队中",
  running: "后台执行中",
  completed: "本轮执行已结束",
  cancelled: "执行已停止",
  failed: "执行失败，请检查项目状态",
  interrupted: "执行已中断，可重新提交",
};

export function ProjectExecutionStatus({
  job,
  isRunning,
  cancel,
}: {
  job: ProjectExecution | null | undefined;
  isRunning: boolean;
  cancel: () => void;
}) {
  if (!job) return null;
  return (
    <div className="flex items-center gap-3 text-sm" role="status">
      <span>
        {job.cancel_requested && isRunning
          ? "正在停止后台执行"
          : (labels[job.status] ?? "正在更新执行状态")}
      </span>
      {isRunning && (
        <Button
          variant="outline"
          size="sm"
          disabled={job.cancel_requested}
          onClick={cancel}
        >
          停止执行
        </Button>
      )}
    </div>
  );
}
