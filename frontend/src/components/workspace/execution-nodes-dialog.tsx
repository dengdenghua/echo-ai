import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/core/i18n/hooks";
import {
  executionRequest,
  downloadNodeArtifact,
  type ExecutionNode,
  type NodeTask,
  type EngineInvocation,
} from "@/core/workspace/execution-nodes";
import type { Workspace } from "@/core/workspace/api";

export function ExecutionNodesDialog({
  open,
  onOpenChange,
  spaces,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  spaces: Workspace[];
}) {
  const { locale } = useI18n();
  const zh = locale.startsWith("zh");
  const [workspace, setWorkspace] = useState("");
  const [nodes, setNodes] = useState<ExecutionNode[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [role, setRole] = useState("");
  const [goal, setGoal] = useState("");
  const [tasks, setTasks] = useState<NodeTask[]>([]);
  const [invocations, setInvocations] = useState<EngineInvocation[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const roles = nodes
    .filter((n) => selected.includes(n.node_id))
    .reduce<
      string[]
    >((all, node, index) => (index === 0 ? node.roles : all.filter((r) => node.roles.includes(r))), []);
  const statuses: Record<string, string> = zh
    ? {
        queued: "排队",
        running: "执行中",
        waiting: "已暂停",
        interrupted: "等待接续",
        completed: "已交付",
        failed: "失败",
        cancelled: "已取消",
      }
    : {};
  useEffect(() => {
    if (!open) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const data = await executionRequest<{ tasks: NodeTask[] }>("/tasks");
        if (active) setTasks(data.tasks);
        const history = await executionRequest<{
          invocations: EngineInvocation[];
        }>("/invocations");
        if (active) setInvocations(history.invocations);
      } catch (e) {
        if (active) setError(String(e));
      }
      if (active) timer = setTimeout(() => void refresh(), 3000);
    };
    void refresh();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [open]);
  useEffect(() => {
    if (!open || !workspace) return;
    let active = true;
    setNodes([]);
    setSelected([]);
    setRole("");
    setError("");
    void executionRequest<{ nodes: ExecutionNode[] }>(
      `/nodes?workspace_id=${encodeURIComponent(workspace)}`,
    )
      .then((data) => {
        if (active) setNodes(data.nodes);
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, [open, workspace]);
  const act = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {zh ? "设备上的后台任务" : "Background tasks on devices"}
          </DialogTitle>
          <DialogDescription>
            {zh
              ? "选择已接入的 Echo 设备处理项目文件。任务保存在服务端，关闭窗口不会取消；选多台设备可在掉线后接续。"
              : "Process project files on connected Echo devices. Closing this window keeps tasks running. Select multiple devices for recovery."}
          </DialogDescription>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          {zh
            ? "当前入口用于文件读取、生成与编辑。提交会固定控制端项目文件的当前版本，接管和重试继续使用此版本；之后的修改需另建任务。控制端须能访问项目目录，并与至少一台执行设备保持在线。交付可下载或应用，原文件已改变时会保留冲突。"
            : "For file reading, generation and editing. Submission freezes the controller's current project files; recovery uses that same version. Later edits need a new task. The controller must have project access and stay online with an execution device. Download or apply deliveries; changed originals are preserved."}
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="text-sm">
            {notice}
          </p>
        )}
        <label className="text-sm">
          {zh ? "共享项目" : "Shared project"}
          <select
            aria-label={zh ? "共享项目" : "Shared project"}
            className="w-full rounded border bg-background p-2"
            value={workspace}
            disabled={busy}
            onChange={(e) => {
              setWorkspace(e.target.value);
              setRequestId(crypto.randomUUID());
            }}
          >
            <option value="">{zh ? "选择项目" : "Choose project"}</option>
            {spaces.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        {workspace && nodes.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {zh
              ? "暂无设备提供这个项目。请在运行 Echo 的设备上配置执行节点及该项目目录映射。"
              : "No device offers this project. Configure an execution node with this workspace mapping."}
          </p>
        )}
        {nodes.map((node) => (
          <label key={node.node_id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              disabled={busy}
              checked={selected.includes(node.node_id)}
              onChange={(e) => {
                setSelected((old) =>
                  e.target.checked
                    ? [...old, node.node_id]
                    : old.filter((id) => id !== node.node_id),
                );
                setRole("");
                setRequestId(crypto.randomUUID());
              }}
            />
            {node.label} ·{" "}
            {node.online
              ? zh
                ? "在线"
                : "Online"
              : zh
                ? "离线，可排队"
                : "Offline, queue available"}
          </label>
        ))}
        <label className="text-sm">
          {zh ? "执行角色" : "Role"}
          <select
            className="w-full rounded border bg-background p-2"
            value={role}
            disabled={busy}
            onChange={(e) => {
              setRole(e.target.value);
              setRequestId(crypto.randomUUID());
            }}
          >
            <option value="">
              {zh ? "选择共同可用的角色" : "Choose an available role"}
            </option>
            {roles.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <textarea
          aria-label={zh ? "任务要求" : "Task instructions"}
          className="min-h-24 rounded border bg-background p-2 text-sm"
          value={goal}
          disabled={busy}
          placeholder={
            zh
              ? "要处理哪些文件，交付什么结果…"
              : "Files to process and expected output…"
          }
          onChange={(e) => {
            setGoal(e.target.value);
            setRequestId(crypto.randomUUID());
          }}
        />
        <Button
          disabled={
            busy || !workspace || !role || !goal.trim() || !selected.length
          }
          onClick={() =>
            void act(async () => {
              const task = await executionRequest<NodeTask>("/tasks", {
                request_id: requestId,
                workspace_id: workspace,
                node_ids: selected,
                role,
                goal,
              });
              setTasks((old) => [
                task,
                ...old.filter((t) => t.run_id !== task.run_id),
              ]);
              setGoal("");
              setRequestId(crypto.randomUUID());
              setNotice(
                zh
                  ? "任务已保存，可关闭窗口。执行设备会领取并返回交付。"
                  : "Task saved. You can close this window; a device will claim it.",
              );
            })
          }
        >
          {zh ? "提交后台任务" : "Submit background task"}
        </Button>
        {tasks
          .filter((t) => !workspace || t.input.workspace_id === workspace)
          .map((task) => (
            <div
              className="space-y-2 rounded border p-3 text-sm"
              key={task.run_id}
            >
              <div className="font-medium">{task.input.goal}</div>
              {task.input.input_snapshot && (
                <p className="text-xs text-muted-foreground">
                  {zh
                    ? `已固定提交时的 ${task.input.input_snapshot.file_count} 个文件；接管继续使用此版本。`
                    : `Pinned ${task.input.input_snapshot.file_count} submitted files; recovery uses the same version.`}
                  {task.input.input_snapshot.skipped_count > 0 &&
                    (zh
                      ? ` ${task.input.input_snapshot.skipped_count} 项凭证、依赖或链接等已排除。`
                      : ` ${task.input.input_snapshot.skipped_count} credential, dependency or linked entries excluded.`)}
                </p>
              )}
              <p>
                {statuses[task.status] || task.status} ·{" "}
                {zh ? "执行次数" : "Attempts"} {task.attempt}
                {task.lease_owner ? ` · ${task.lease_owner.split(":")[0]}` : ""}
              </p>
              {task.error && <p className="text-destructive">{task.error}</p>}
              {task.result?.output && (
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap">
                  {task.result.output}
                </pre>
              )}
              <div className="flex flex-wrap gap-2">
                {!["completed", "failed", "cancelled"].includes(
                  task.status,
                ) && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          const updated = await executionRequest<NodeTask>(
                            `/tasks/${task.run_id}/actions`,
                            {
                              action:
                                task.status === "waiting" ? "resume" : "pause",
                            },
                          );
                          setTasks((old) =>
                            old.map((t) =>
                              t.run_id === task.run_id ? updated : t,
                            ),
                          );
                        })
                      }
                    >
                      {task.status === "waiting"
                        ? zh
                          ? "接续"
                          : "Resume"
                        : zh
                          ? "暂停"
                          : "Pause"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          const updated = await executionRequest<NodeTask>(
                            `/tasks/${task.run_id}/actions`,
                            { action: "cancel" },
                          );
                          setTasks((old) =>
                            old.map((t) =>
                              t.run_id === task.run_id ? updated : t,
                            ),
                          );
                        })
                      }
                    >
                      {zh ? "取消任务" : "Cancel task"}
                    </Button>
                  </>
                )}
                {task.result?.artifacts.map((artifact, i) => (
                  <Button
                    key={artifact.path}
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void act(() =>
                        downloadNodeArtifact(task.run_id, i, artifact.path),
                      )
                    }
                  >
                    {zh ? "下载" : "Download"} {artifact.path}
                  </Button>
                ))}
                {!!task.result?.artifacts.length && (
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        await executionRequest(
                          `/tasks/${task.run_id}/actions`,
                          { action: "apply" },
                        );
                        setNotice(
                          zh
                            ? "交付已应用到共享项目。"
                            : "Delivery applied to the shared project.",
                        );
                      })
                    }
                  >
                    {zh ? "应用交付到项目" : "Apply delivery to project"}
                  </Button>
                )}
              </div>
            </div>
          ))}
        <details className="rounded border p-3 text-sm">
          <summary className="cursor-pointer">
            {zh ? "各引擎执行记录" : "Engine execution history"} (
            {invocations.length})
          </summary>
          <p className="my-2 text-xs text-muted-foreground">
            {zh
              ? "记录本地与设备上的引擎调用。执行结束只表示调用完成，交付是否合格仍需核验。"
              : "Engine invocations on this service. A finished invocation does not certify its deliverables."}
          </p>
          {invocations.map((run) => (
            <div key={run.run_id} className="my-2 border-t pt-2">
              <p>{run.input.goal}</p>
              <p className="text-xs text-muted-foreground">
                {run.input.engine} · {run.input.device_id} ·{" "}
                {run.status === "completed"
                  ? zh
                    ? "执行结束"
                    : "Finished"
                  : statuses[run.status] || run.status}
              </p>
              {run.error && <p className="text-destructive">{run.error}</p>}
              {run.status === "running" && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      const updated = await executionRequest<EngineInvocation>(
                        `/invocations/${run.run_id}/cancel`,
                        {},
                      );
                      setInvocations((old) =>
                        old.map((item) =>
                          item.run_id === run.run_id ? updated : item,
                        ),
                      );
                    })
                  }
                >
                  {zh ? "停止执行" : "Stop execution"}
                </Button>
              )}
            </div>
          ))}
        </details>
      </DialogContent>
    </Dialog>
  );
}
