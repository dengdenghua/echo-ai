import type { DeviceTask, TaskStage } from "./task-workspace-api";

const field = "w-full rounded-lg border p-2 text-sm";
const button = "rounded-lg border px-3 py-1.5 text-xs disabled:opacity-40";

type Device = {
  id: string;
  online: boolean;
  model?: string;
  platform?: string;
};

export function TaskStageEditor({
  stages,
  devices,
  disabled,
  onChange,
}: {
  stages: TaskStage[];
  devices: Device[];
  disabled: boolean;
  onChange: (stages: TaskStage[]) => void;
}) {
  const update = (index: number, value: Partial<TaskStage>) =>
    onChange(
      stages.map((stage, i) => (i === index ? { ...stage, ...value } : stage)),
    );
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        按顺序填写每台设备的目标。核对当前阶段后，再为下一阶段生成计划。
      </p>
      {stages.map((stage, index) => (
        <fieldset
          key={index}
          disabled={disabled}
          className="space-y-2 rounded-lg border p-3"
        >
          <legend className="px-1 text-xs">第 {index + 1} 阶段</legend>
          <select
            className={field}
            aria-label={`第 ${index + 1} 阶段设备`}
            value={stage.device_id}
            onChange={(event) =>
              update(index, { device_id: event.target.value })
            }
          >
            <option value="">选择设备</option>
            {devices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.model || device.id} · {device.platform}
                {device.online ? "" : "（离线）"}
              </option>
            ))}
          </select>
          <textarea
            className={field}
            aria-label={`第 ${index + 1} 阶段任务`}
            maxLength={1024}
            placeholder="这台设备需要完成什么"
            value={stage.task}
            onChange={(event) => update(index, { task: event.target.value })}
          />
          {stages.length > 2 && (
            <button
              type="button"
              className={button}
              onClick={() => onChange(stages.filter((_, i) => i !== index))}
            >
              移除第 {index + 1} 阶段
            </button>
          )}
        </fieldset>
      ))}
      <button
        type="button"
        className={button}
        disabled={disabled || stages.length >= 8}
        onClick={() => onChange([...stages, { device_id: "", task: "" }])}
      >
        添加阶段
      </button>
    </div>
  );
}

export function TaskStages({ task }: { task: DeviceTask }) {
  if (!task.stages?.length) return null;
  const current = task.stage_index ?? 0;
  return (
    <div className="space-y-2 rounded-lg border p-3 text-xs">
      <p>
        阶段 {current + 1} / {task.stages.length} · 当前阶段：
        {task.stages[current]?.task}
      </p>
      <ol className="space-y-1">
        {task.stages.map((stage, index) => (
          <li key={index}>
            {index + 1}. {stage.device_id} · {stage.task} ·{" "}
            {index < current
              ? "已核对"
              : index === current
                ? "当前阶段"
                : "等待接续"}
          </li>
        ))}
      </ol>
      {!!task.stage_history?.length && (
        <details>
          <summary className="cursor-pointer">前序阶段结果</summary>
          {task.stage_history.map((stage, index) => (
            <div key={index} className="mt-2 space-y-1">
              <p>
                {stage.device_id} · {stage.task} · 核对人：
                {stage.result_review?.reviewed_by}
              </p>
              {stage.results.map((result, i) => (
                <p key={i} className="whitespace-pre-wrap break-all">
                  {result.error || result.summary}
                </p>
              ))}
            </div>
          ))}
        </details>
      )}
    </div>
  );
}
