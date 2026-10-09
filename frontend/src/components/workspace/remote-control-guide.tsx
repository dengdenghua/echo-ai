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
  const copy = useI18n().t.workLocation;
  return (
    <div className="grid gap-3" data-testid="remote-control-guide">
      <ol className="grid list-decimal gap-2 pl-5 text-sm leading-relaxed">
        {copy.guideSteps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <pre className="overflow-x-auto rounded-lg border bg-muted/50 p-3 font-mono text-xs leading-relaxed">
        {NODE_CONFIG}
      </pre>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {copy.guideNote}
      </p>
    </div>
  );
}
