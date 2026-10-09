import { useI18n } from "@/core/i18n/hooks";

const NODE_CONFIG = `{
  "controller_url": "https://<this-computer>",
  "node_id": "study-nas",
  "label": "书房 NAS",
  "roles": ["eve"],
  "workspace_ids": ["<shared-workspace-id>"]
}`;

/** How to make another machine's Echo an execution node of this one. */
export function RemoteControlGuide() {
  const { locale } = useI18n();
  const zh = locale.startsWith("zh");
  const steps = zh
    ? [
        "在那台机器上保存下面的 node.json，填好这台电脑的 HTTPS 地址和要开放的共享空间 ID（非本机地址必须用 HTTPS）。",
        "设置环境变量 ECHO_EXECUTION_NODE_CONFIG 指向 node.json，ECHO_EXECUTION_NODE_TOKEN 填这台电脑上管理员账号的访问令牌。",
        "在那台机器的配置里设 execution.member_engine: echo（执行节点只运行原生引擎角色），然后启动 Echo。",
      ]
    : [
        "Save this node.json on that machine with this computer's HTTPS address and the shared workspace IDs to offer (non-local addresses require HTTPS).",
        "Set ECHO_EXECUTION_NODE_CONFIG to the node.json path and ECHO_EXECUTION_NODE_TOKEN to an access token of an admin on this computer.",
        "Set execution.member_engine: echo in that machine's config (nodes only run native-engine roles), then start Echo.",
      ];
  return (
    <div className="grid gap-3" data-testid="remote-control-guide">
      <ol className="grid list-decimal gap-2 pl-5 text-sm leading-relaxed">
        {steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <pre className="overflow-x-auto rounded-lg border bg-muted/50 p-3 font-mono text-xs leading-relaxed">
        {NODE_CONFIG}
      </pre>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {zh
          ? "节点上线后会出现在「工作位置 → 远程控制」里。它在共享空间的快照里工作，只能读写文件、不能运行命令；改动随回复交回。"
          : "Once online, the node appears under Work location → Remote control. It works in a snapshot of a shared workspace with file tools only; changes come back with the reply."}
      </p>
    </div>
  );
}
