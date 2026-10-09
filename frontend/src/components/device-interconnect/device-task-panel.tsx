import { useEffect, useRef, useState } from "react";
import { useDeviceDirectory } from "./device-directory";
import { TaskStageEditor, TaskStages } from "./task-stages";
import {
  taskWorkspaceRequest,
  type DeviceTask,
  type TaskStage,
} from "./task-workspace-api";

const labels: Record<string, string> = {
  planning: "正在生成计划",
  awaiting_handoff: "等待阶段交接",
  awaiting_approval: "等待确认",
  running: "正在执行",
  paused: "已暂停",
  interrupted: "已中断",
  succeeded: "步骤已执行",
  failed: "执行失败",
  cancelled: "已取消",
  emergency_stopped: "已停止",
};
const button = "rounded-lg border px-3 py-1.5 text-xs disabled:opacity-40";

export function DeviceTaskPanel() {
  const directory = useDeviceDirectory();
  const [tasks, setTasks] = useState<DeviceTask[]>([]);
  const [stages, setStages] = useState<TaskStage[]>([]);
  const [target, setTarget] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const submission = useRef({ key: "", id: "" });
  const [busy, setBusy] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await taskWorkspaceRequest<{ tasks: DeviceTask[] }>(
          "list",
          {},
          controller.signal,
        );
        if (!Array.isArray(result.tasks))
          throw new Error("设备中心返回的任务列表不完整");
        if (!controller.signal.aborted) {
          setTasks(result.tasks);
          setLoading(false);
          setLoadError("");
        }
      } catch (reason) {
        if (!controller.signal.aborted) {
          setTasks([]);
          setLoading(false);
          setLoadError(
            reason instanceof Error ? reason.message : "读取任务失败",
          );
        }
      }
      if (!controller.signal.aborted)
        timer = setTimeout(() => void poll(), 3000);
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [refresh]);
  const perform = async (
    command: string,
    args: Record<string, unknown>,
    id: string,
  ) => {
    if (busy) return;
    setBusy(id);
    setError("");
    try {
      await taskWorkspaceRequest(command, args, AbortSignal.timeout(15000));
      if (command === "submit") {
        setText("");
        setStages([]);
        submission.current = { key: "", id: "" };
      }
      setRefresh((value) => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "操作失败");
    } finally {
      setBusy("");
    }
  };
  return (
    <section
      aria-label="跨端任务"
      className="space-y-3 rounded-2xl border bg-card p-4 text-foreground"
    >
      <div>
        <h2 className="font-semibold">跨端任务</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          在已连接设备上执行任务，进度和结果保存在设备中心，换端后可继续查看。
        </p>
      </div>
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          const key = JSON.stringify([target, text, stages]);
          if (submission.current.key !== key)
            submission.current = {
              key,
              id:
                globalThis.crypto?.randomUUID?.() ||
                `task-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            };
          void perform(
            "submit",
            {
              id: submission.current.id,
              task: text,
              ...(stages.length ? { stages } : { device_id: target }),
            },
            "submit",
          );
        }}
      >
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={stages.length > 0}
            disabled={!!busy}
            onChange={(event) =>
              setStages(
                event.target.checked
                  ? [
                      { device_id: target, task: "" },
                      { device_id: "", task: "" },
                    ]
                  : [],
              )
            }
          />
          多设备接续
        </label>
        {stages.length ? (
          <TaskStageEditor
            stages={stages}
            devices={directory.status?.devices || []}
            disabled={!!busy}
            onChange={setStages}
          />
        ) : (
          <select
            disabled={!!busy}
            aria-label="执行设备"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            className="w-full rounded-lg border p-2 text-sm"
          >
            <option value="">选择执行设备</option>
            {directory.status?.devices.map((device) => (
              <option
                key={device.id}
                value={device.id}
                disabled={!device.online}
              >
                {device.model || device.id} · {device.platform}
                {!device.online ? " · 离线" : ""}
              </option>
            ))}
          </select>
        )}
        <textarea
          disabled={!!busy}
          aria-label="任务内容"
          placeholder="描述你希望这台设备完成的任务"
          maxLength={4096}
          value={text}
          onChange={(event) => setText(event.target.value)}
          className="w-full rounded-lg border p-2 text-sm"
        />
        <button
          className={button}
          disabled={
            !!busy ||
            !text.trim() ||
            (stages.length > 0
              ? stages.some(
                  (stage) => !stage.device_id || !stage.task.trim(),
                ) ||
                !directory.status?.devices.some(
                  (d) => d.id === stages[0]?.device_id && d.online,
                )
              : !directory.status?.devices.some(
                  (d) => d.id === target && d.online,
                ))
          }
        >
          生成执行计划
        </button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {loadError && (
        <p role="alert" className="text-sm text-red-700">
          {loadError}
        </p>
      )}
      {loading ? (
        <p role="status">正在读取任务…</p>
      ) : (
        tasks.length === 0 && (
          <p className="text-xs text-muted-foreground">还没有跨端任务。</p>
        )
      )}
      {tasks.map((task) => {
        const ended = [
          "succeeded",
          "failed",
          "cancelled",
          "emergency_stopped",
        ].includes(task.status);
        const uncertain = task.in_flight_step !== null && !task.busy;
        const args = { id: task.id, revision: task.revision };
        return (
          <article key={task.id} className="space-y-2 rounded-xl border p-3">
            <h3 className="break-words text-sm font-medium">{task.task}</h3>
            <p className="break-all text-xs text-muted-foreground">
              {task.source_device || "电脑"} → {task.device_id}
            </p>
            <p className="text-xs">
              {labels[task.status] || task.status} · 已确认 {task.current_step}{" "}
              / {task.steps.length} 步
              {task.busy &&
              task.status !== "planning" &&
              task.status !== "running"
                ? " · 等待当前步骤结束"
                : ""}
            </p>
            <TaskStages task={task} />
            {(task.status === "succeeded" ||
              task.status === "awaiting_handoff") && (
              <div className="space-y-2 rounded-lg bg-muted/50 p-3 text-xs">
                <p>
                  {task.result_review?.outcome === "achieved"
                    ? "已由用户确认完成"
                    : task.result_review?.outcome === "not_achieved"
                      ? "用户核对：目标尚未完成"
                      : "结果待确认：步骤已执行，请到目标设备检查实际结果。"}
                </p>
                {task.result_review && (
                  <p className="text-muted-foreground">
                    核对人：{task.result_review.reviewed_by}
                  </p>
                )}
                <p className="text-muted-foreground">
                  核对只更新结果记录，不会再次执行操作。
                </p>
                <div className="flex flex-wrap gap-2">
                  {(["achieved", "not_achieved"] as const).map((outcome) => (
                    <button
                      key={outcome}
                      className={button}
                      disabled={
                        !!busy ||
                        task.busy ||
                        task.result_review?.outcome === outcome
                      }
                      onClick={() =>
                        void perform(
                          "review_result",
                          { ...args, outcome },
                          task.id,
                        )
                      }
                    >
                      {outcome === "achieved"
                        ? "我已核对，确认完成"
                        : "我已核对，尚未完成"}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {task.steps.length > 0 && (
              <details open={task.status === "awaiting_approval"}>
                <summary className="cursor-pointer text-xs">
                  查看执行计划
                </summary>
                <ol className="mt-2 space-y-2 text-xs">
                  {task.steps.map((step, index) => (
                    <li key={index}>
                      {index + 1}. {step.action}
                      {index < task.current_step ? " · 已完成" : ""}
                      <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/50 p-2">
                        {JSON.stringify(step.arguments, null, 2)}
                      </pre>
                    </li>
                  ))}
                </ol>
              </details>
            )}
            {task.error && (
              <p className="text-xs text-amber-800">{task.error}</p>
            )}
            {uncertain && (
              <p className="text-xs text-amber-800">
                第 {task.in_flight_step! + 1}{" "}
                步结果不明。请到目标设备核对；若未完成，可取消任务后重新规划。
              </p>
            )}
            {task.results.length > 0 && (
              <details>
                <summary className="cursor-pointer text-xs">
                  最近执行结果
                </summary>
                {task.results.map((result, index) => (
                  <p
                    key={index}
                    className="mt-1 whitespace-pre-wrap break-all text-xs"
                  >
                    第 {result.step + 1} 步 · {result.success ? "成功" : "失败"}
                    ：{result.error || result.summary}
                  </p>
                ))}
              </details>
            )}
            <div className="flex flex-wrap gap-2">
              {task.status === "awaiting_handoff" && (
                <button
                  className={button}
                  disabled={
                    !!busy ||
                    task.busy ||
                    task.result_review?.outcome !== "achieved"
                  }
                  onClick={() => void perform("advance", args, task.id)}
                >
                  交给下一台设备规划
                </button>
              )}
              {["awaiting_approval", "paused", "interrupted"].includes(
                task.status,
              ) && (
                <button
                  className={button}
                  disabled={!!busy || task.busy}
                  onClick={() =>
                    void perform(
                      task.status === "awaiting_approval"
                        ? "approve"
                        : "resume",
                      {
                        ...args,
                        ...(uncertain ? { resolution: "completed" } : {}),
                      },
                      task.id,
                    )
                  }
                >
                  {uncertain
                    ? "已核对完成，继续"
                    : task.status === "awaiting_approval"
                      ? "确认计划并执行"
                      : task.steps.length
                        ? "继续任务"
                        : "重新生成计划"}
                </button>
              )}
              {task.status === "running" && (
                <button
                  className={button}
                  disabled={!!busy}
                  onClick={() => void perform("pause", args, task.id)}
                >
                  暂停后续步骤
                </button>
              )}
              {!ended && (
                <button
                  className={button}
                  disabled={!!busy}
                  onClick={() => void perform("cancel", args, task.id)}
                >
                  取消任务
                </button>
              )}
              {ended && !task.busy && (
                <button
                  className={button}
                  disabled={!!busy}
                  onClick={() => void perform("remove", args, task.id)}
                >
                  移除记录
                </button>
              )}
            </div>
          </article>
        );
      })}
    </section>
  );
}

export function DeviceTaskSection() {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="rounded-2xl border px-4 py-3"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer text-sm font-medium">跨端任务</summary>
      {open && (
        <div className="mt-3">
          <DeviceTaskPanel />
        </div>
      )}
    </details>
  );
}
