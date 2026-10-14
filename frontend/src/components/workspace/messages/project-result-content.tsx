import { CheckCircle2, CircleDashed, FolderKanban, Files, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { emitOpenAgentWorkbench } from "../agent-workbench-events";
import { useOptionalArtifacts } from "../artifacts/context";
import { artifactDisplayPath, parseWorkspaceOutputRef } from "@/core/artifacts/utils";
import { dispatchOpenArtifact } from "@/core/artifacts/open-artifact";
import { useI18n } from "@/core/i18n/hooks";
import { projectResultCopy } from "@/core/i18n/locales/project-result";
import {
  parseCollaborationLandmark,
  ProjectCollaborationLandmark,
} from "./project-collaboration-landmark";

/** Strict compatibility reader for persisted Project OS receipts. Never infer success. */
export function parseProjectReceipt(content: string) {
  if (!/^Project OS 已(?:继续推进项目|接管并运行项目|执行控制命令)。/.test(content.trim())) return null;
  const project = /^项目：(.+)（(P-[\w-]+)）\s*$/m.exec(content);
  const state = /^状态：(done|running|blocked|failed|planning|pending)(?:\s|·|$)/m.exec(content);
  if (!project || !state) return null;
  const counts = [...content.matchAll(/^\s*-\s+[^\n]+：[\w]+ · (\d+)\/(\d+) 任务完成/gm)];
  const done = counts.reduce((sum, item) => sum + Number(item[1]), 0);
  const total = counts.reduce((sum, item) => sum + Number(item[2]), 0);
  return { name: project[1], id: project[2], status: state[1], done, total };
}

export function ProjectResultContent({ content, isLoading, renderBody }: {
  content: string;
  isLoading?: boolean;
  renderBody: (text: string) => ReactNode;
}) {
  const { locale, t } = useI18n();
  const copy = projectResultCopy(locale);
  const artifactContext = useOptionalArtifacts();
  const finalFiles = [...new Set(artifactContext?.artifacts ?? [])].filter(
    path => parseWorkspaceOutputRef(path)?.area === "final",
  );
  const receipt = !isLoading ? parseProjectReceipt(content) : null;
  if (!receipt) {
    const landmark = !isLoading ? parseCollaborationLandmark(content) : null;
    if (landmark) {
      return (
        <ProjectCollaborationLandmark
          match={landmark}
          rawContent={content}
          renderBody={renderBody}
        />
      );
    }
    return renderBody(content);
  }
  const complete = receipt.status === "done";
  const blocked = receipt.status === "blocked" || receipt.status === "failed";
  const label = complete ? copy.status.done : blocked ? copy.status.blocked : receipt.status === "running" ? copy.status.running : copy.status.pending;
  const Icon = complete ? CheckCircle2 : blocked ? TriangleAlert : CircleDashed;
  return (
    <section aria-label={copy.regionLabel} className="my-3 w-full min-w-0 overflow-hidden rounded-xl border bg-card text-card-foreground">
      <div className="flex items-start gap-3 p-4">
        <Icon aria-hidden="true" className={`mt-0.5 size-5 shrink-0 ${complete ? "text-core" : blocked ? "text-warning" : "text-primary"}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="break-words text-sm font-semibold">{receipt.name}</h3>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{label}</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {receipt.total > 0 ? copy.tasksDone(receipt.done, receipt.total) : copy.statusUpdated}
            {" · "}
            {blocked ? copy.hint.blocked : complete ? copy.hint.done : copy.hint.running}
          </p>
        </div>
      </div>
      {complete && finalFiles.length > 0 && (
        <div className="space-y-2 px-4 pb-4">
          <p className="text-xs text-muted-foreground">{copy.finalFiles(finalFiles.length)}</p>
          {finalFiles.slice(0, 3).map(path => (
            <button key={path} type="button" onClick={() => dispatchOpenArtifact(path)} className="flex w-full min-w-0 items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2.5 text-left hover:bg-muted focus-visible:outline focus-visible:outline-2">
              <Files className="size-4 shrink-0 text-primary" aria-hidden="true" />
              <span className="min-w-0 flex-1 break-all text-sm font-medium">{artifactDisplayPath(path)}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{t.common.preview}</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2 px-4 pb-4">
        {(!complete || finalFiles.length === 0 || finalFiles.length > 3) && (
        <button type="button" className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground focus-visible:outline focus-visible:outline-2" onClick={() => emitOpenAgentWorkbench({ tab: "artifacts" })}>
          <Files className="size-3.5" aria-hidden="true" />{finalFiles.length > 3 ? copy.viewAllResults : copy.viewResults}
        </button>
        )}
        <a className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs hover:bg-muted focus-visible:outline focus-visible:outline-2" href={`#/workspace/projects?project=${encodeURIComponent(receipt.id!)}`}>
          <FolderKanban className="size-3.5" aria-hidden="true" />{copy.viewProject}
        </a>
      </div>
      <details className="border-t px-4 py-2.5">
        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">{copy.details}</summary>
        <div className="mt-3 max-h-80 overflow-auto text-sm">{renderBody(content)}</div>
      </details>
    </section>
  );
}
