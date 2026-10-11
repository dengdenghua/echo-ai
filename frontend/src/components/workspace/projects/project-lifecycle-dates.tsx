import { CalendarRangeIcon, CheckCircle2Icon, PlayIcon } from "lucide-react";
import { fmtDateTime } from "./project-meta";

export function ProjectLifecycleDates({
  project,
}: {
  project: {
    created_at: string;
    started_at: string;
    finished_at: string;
  };
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1">
        <CalendarRangeIcon className="size-3.5" />
        创建 {fmtDateTime(project.created_at)}
      </span>
      {project.started_at && (
        <span className="inline-flex items-center gap-1">
          <PlayIcon className="size-3.5" />
          启动 {fmtDateTime(project.started_at)}
        </span>
      )}
      {project.finished_at && (
        <span className="inline-flex items-center gap-1">
          <CheckCircle2Icon className="size-3.5" />
          完成 {fmtDateTime(project.finished_at)}
        </span>
      )}
    </div>
  );
}
