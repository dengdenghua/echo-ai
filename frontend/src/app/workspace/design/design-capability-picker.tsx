import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState } from "react";
import {
  resolveDesignCapabilities,
  type DesignCapabilities,
  type DesignCapabilityPlan,
} from "@/core/design/capabilities";

const LABELS: Record<string, string> = {
  "frontend-ui-engineering": "界面设计与实现",
  "webapp-building": "网页制作",
  presentations: "演示文稿",
  "creative-video-editor": "视频剪辑",
  "creative-storyboard-assets": "分镜与素材",
  "creative-visual-direction": "视觉风格",
  "creative-ecommerce-images": "商品图片",
  "creative-comfyui-workflow": "ComfyUI 工作流",
  comfyui_bridge: "ComfyUI",
  clip_studio: "视频编辑器",
};

export function DesignCapabilityPicker({
  goal,
  value,
  onChange,
  onManage,
  onSkills,
}: {
  goal: string;
  value: DesignCapabilities;
  onChange: (value: DesignCapabilities) => void;
  onManage: () => void;
  onSkills: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<DesignCapabilityPlan | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setPlan(null);
    setError("");
    const timer = setTimeout(() => {
      void resolveDesignCapabilities(goal, value, false, controller.signal)
        .then((result) => {
          if (!controller.signal.aborted) setPlan(result);
        })
        .catch((e) => {
          if (!controller.signal.aborted)
            setError(e instanceof Error ? e.message : "能力检查失败");
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [goal, value, open, retry]);
  const toggle = (kind: "skills" | "plugins", id: string) => {
    const current =
      value.mode === "auto"
        ? {
            mode: "manual" as const,
            skills: plan?.skills ?? [],
            plugins: plan?.plugins ?? [],
          }
        : value;
    onChange({
      ...current,
      [kind]: current[kind].includes(id)
        ? current[kind].filter((x) => x !== id)
        : [...current[kind], id],
    });
  };
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="h-8 rounded-md px-2 hover:bg-muted/60"
          aria-expanded={open}
        >
          设计能力 · {value.mode === "auto" ? "自动" : "手动"}
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/20" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[min(400px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-xl border bg-background p-4 text-left text-xs shadow-xl"
        >
          <Dialog.Title className="sr-only">设计能力设置</Dialog.Title>
          <section aria-label="设计能力">
            <div className="flex items-center justify-between">
              <strong>设计能力</strong>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="关闭设计能力"
              >
                关闭
              </button>
            </div>
            <p className="my-3 text-muted-foreground">
              基础规范始终生效：布局、字体、配色、可访问性与结果检查。
            </p>
            <div className="mb-3 flex gap-2">
              {(["auto", "manual"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={value.mode === mode}
                  className="rounded border px-3 py-1 aria-pressed:bg-muted"
                  onClick={() =>
                    onChange(
                      mode === "auto"
                        ? { mode, skills: [], plugins: [] }
                        : {
                            mode,
                            skills: plan?.skills ?? [],
                            plugins: plan?.plugins ?? [],
                          },
                    )
                  }
                >
                  {mode === "auto" ? "自动选择" : "手动调整"}
                </button>
              ))}
            </div>
            {error ? (
              <p role="alert">
                {error}{" "}
                <button
                  type="button"
                  className="underline"
                  onClick={() => setRetry((x) => x + 1)}
                >
                  重试
                </button>
              </p>
            ) : !plan ? (
              <p role="status">正在匹配能力…</p>
            ) : (
              <>
                <p className="mb-2">
                  {plan.tasks.length
                    ? plan.tasks.join(" · ")
                    : "根据输入的任务选择专项能力"}
                </p>
                <div className="max-h-60 space-y-2 overflow-auto">
                  {(["skills", "plugins"] as const).map((kind) => (
                    <div key={kind}>
                      <strong>
                        {kind === "skills" ? "专项技能" : "执行工具"}
                      </strong>
                      {(kind === "skills"
                        ? plan.available_skills
                        : plan.available_plugins
                      ).map((item) => (
                        <label
                          key={item.id}
                          className="mt-2 flex items-center gap-2"
                        >
                          <input
                            type="checkbox"
                            disabled={
                              !item.available && !value[kind].includes(item.id)
                            }
                            checked={(value.mode === "auto"
                              ? plan[kind]
                              : value[kind]
                            ).includes(item.id)}
                            onChange={() => toggle(kind, item.id)}
                          />
                          <span>{LABELS[item.id] ?? item.id}</span>
                          {!item.available && (
                            <span className="text-muted-foreground">
                              未启用
                            </span>
                          )}
                        </label>
                      ))}
                      {kind === "plugins" && !plan.available_plugins.length && (
                        <p className="mt-2 text-muted-foreground">
                          暂无已注册的设计插件
                        </p>
                      )}
                    </div>
                  ))}
                </div>
                {[...plan.blockers, ...plan.warnings].map((note) => (
                  <p className="mt-2 text-amber-600" key={note}>
                    {note}
                  </p>
                ))}
              </>
            )}
            <p className="mt-3 text-muted-foreground">
              提交时重新检查可用性；需要生成服务时再检查连接与授权。
            </p>
            <div className="mt-3 flex gap-4 border-t pt-3">
              <button type="button" className="underline" onClick={onManage}>
                管理插件
              </button>
              <button type="button" className="underline" onClick={onSkills}>
                管理技能
              </button>
            </div>
          </section>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
