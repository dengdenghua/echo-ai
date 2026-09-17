import { useState } from "react";
import { Users, Radio } from "lucide-react";

import { EchoModelHotspotSettings } from "./echo-model-hotspot";
import { TeamGatewaySettings } from "./team-gateway-settings";

export function ModelSharingSettings({
  onConnected,
}: {
  onConnected: () => void;
}) {
  const [mode, setMode] = useState<"personal" | "team">("personal");
  return (
    <section
      aria-label="模型共享"
      className="space-y-4 rounded-xl border p-4 sm:p-5"
    >
      <div>
        <h3 className="font-medium">模型共享</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          连接同事或团队提供的模型，在自己的 Echo 中使用。
        </p>
      </div>
      <div
        className="grid grid-cols-1 gap-2 sm:grid-cols-2"
        aria-label="共享方式"
      >
        {(
          [
            ["personal", "个人共享", "连接同事的模型，或分享自己的模型", Radio],
            ["team", "团队模型", "使用团队统一配置的模型与成员授权", Users],
          ] as const
        ).map(([id, title, description, Icon]) => (
          <button
            key={id}
            type="button"
            aria-pressed={mode === id}
            onClick={() => setMode(id)}
            className={`flex min-w-0 items-start gap-3 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${mode === id ? "border-primary/40 bg-primary/5" : "hover:bg-muted/50"}`}
          >
            <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              <span className="block text-sm font-medium">{title}</span>
              <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                {description}
              </span>
            </span>
          </button>
        ))}
      </div>
      <div hidden={mode !== "personal"}>
        <EchoModelHotspotSettings embedded onConnected={onConnected} />
      </div>
      <div hidden={mode !== "team"}>
        <TeamGatewaySettings embedded onConnected={onConnected} />
      </div>
    </section>
  );
}
