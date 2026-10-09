import { CheckIcon, ChevronDownIcon, LaptopIcon, ServerIcon } from "lucide-react";
import { useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  LOCAL_WORK_LOCATION,
  useWorkLocations,
  type ExecutionNodeLocation,
  type WorkLocation,
} from "@/core/execution/work-location";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

function sameNodeTarget(location: WorkLocation, nodeId: string, workspaceId: string, role: string) {
  return (
    location.kind === "node" &&
    location.node_id === nodeId &&
    location.workspace_id === workspaceId &&
    location.role === role
  );
}

/** Where this conversation's next turn runs: this computer or an execution node. */
export function WorkLocationPicker({
  value,
  onChange,
  disabled,
}: {
  value: WorkLocation;
  onChange: (location: WorkLocation) => void;
  disabled?: boolean;
}) {
  const { locale } = useI18n();
  const zh = locale.startsWith("zh");
  const [open, setOpen] = useState(false);
  // Fetch once the user looks, and keep a node selection's label fresh.
  const locations = useWorkLocations(open || value.kind === "node");
  const nodes = locations.data?.execution_nodes ?? [];

  const currentNode =
    value.kind === "node" ? nodes.find((node) => node.node_id === value.node_id) : undefined;
  const nodeLabel =
    value.kind === "node" ? currentNode?.label || value.label || value.node_id : "";
  const offline = value.kind === "node" && currentNode !== undefined && !currentNode.online;
  const triggerLabel =
    value.kind === "node" ? nodeLabel : zh ? "此计算机" : "This computer";
  const title = zh ? "工作位置" : "Work location";

  const choose = (node: ExecutionNodeLocation, workspace: { id: string; name: string }, role: string) =>
    onChange({
      kind: "node",
      node_id: node.node_id,
      workspace_id: workspace.id,
      role,
      label: node.label,
      workspace_name: workspace.name,
    });

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={`${title}: ${triggerLabel}`}
          title={
            value.kind === "node"
              ? `${title}: ${nodeLabel} · ${value.workspace_name ?? value.workspace_id}`
              : `${title}: ${triggerLabel}`
          }
          data-testid="work-location-trigger"
          className={cn(
            "group flex h-8 max-w-[160px] items-center gap-1.5 rounded-lg px-1.5 text-ui font-medium text-muted-foreground transition-colors hover:bg-muted/55 hover:text-foreground disabled:opacity-50",
            value.kind === "node" && "text-foreground",
          )}
        >
          {value.kind === "node" ? (
            <ServerIcon className="size-3.5 shrink-0" />
          ) : (
            <LaptopIcon className="size-3.5 shrink-0" />
          )}
          <span className="truncate">{triggerLabel}</span>
          {offline ? (
            <span className="size-1.5 shrink-0 rounded-full bg-destructive" aria-hidden="true" />
          ) : null}
          <ChevronDownIcon className="size-3 shrink-0 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
          {title}
        </DropdownMenuLabel>
        <DropdownMenuItem
          onSelect={() => onChange(LOCAL_WORK_LOCATION)}
          className="items-start gap-2.5 py-2"
        >
          <LaptopIcon className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block font-medium">{zh ? "此计算机" : "This computer"}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {zh ? "在这台电脑上执行" : "Run on this computer"}
            </span>
          </span>
          {value.kind === "local" ? <CheckIcon className="mt-0.5 size-4 shrink-0 text-primary" /> : null}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
          {zh ? "执行节点" : "Execution nodes"}
        </DropdownMenuLabel>
        {locations.isLoading ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">{zh ? "正在查找…" : "Looking…"}</p>
        ) : locations.isError ? (
          <p className="px-2 py-1.5 text-xs text-destructive">
            {zh ? "暂时无法读取执行节点" : "Execution nodes are unavailable"}
          </p>
        ) : nodes.length === 0 ? (
          <p className="px-2 py-1.5 text-xs leading-relaxed text-muted-foreground">
            {zh
              ? "还没有可用的执行节点。在另一台机器上运行 Echo 并配置为执行节点后，会出现在这里。"
              : "No execution nodes yet. Run Echo on another machine as an execution node and it appears here."}
          </p>
        ) : (
          nodes.flatMap((node) =>
            node.workspaces.map((workspace) => {
              const unavailable = !node.online || !workspace.ready;
              const hint = !node.online
                ? zh ? "离线" : "Offline"
                : !workspace.ready
                  ? zh ? "共享空间未挂载到本机" : "Workspace is not mounted here"
                  : workspace.name;
              const selected = value.kind === "node" && value.node_id === node.node_id && value.workspace_id === workspace.id;
              const body = (
                <>
                  <ServerIcon className="mt-0.5 size-4 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{node.label}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">{hint}</span>
                  </span>
                  {selected ? <CheckIcon className="mt-0.5 size-4 shrink-0 text-primary" /> : null}
                </>
              );
              const key = `${node.node_id}:${workspace.id}`;
              if (node.roles.length > 1 && !unavailable) {
                return (
                  <DropdownMenuSub key={key}>
                    <DropdownMenuSubTrigger className="items-start gap-2.5 py-2">{body}</DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-48">
                      <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
                        {zh ? "由哪个角色执行" : "Run as role"}
                      </DropdownMenuLabel>
                      {node.roles.map((role) => (
                        <DropdownMenuItem key={role} onSelect={() => choose(node, workspace, role)}>
                          <span className="flex-1 truncate">{role}</span>
                          {sameNodeTarget(value, node.node_id, workspace.id, role) ? (
                            <CheckIcon className="size-4 text-primary" />
                          ) : null}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                );
              }
              return (
                <DropdownMenuItem
                  key={key}
                  disabled={unavailable}
                  onSelect={() => choose(node, workspace, node.roles[0]!)}
                  className="items-start gap-2.5 py-2"
                >
                  {body}
                </DropdownMenuItem>
              );
            }),
          )
        )}
        <DropdownMenuSeparator />
        <p className="px-2 py-1.5 text-xs leading-relaxed text-muted-foreground">
          {zh
            ? "执行节点在共享空间的快照里工作，只能读写文件、不能运行命令；改动会随回复交回，可再应用到工作空间。"
            : "Nodes work in a snapshot of the shared workspace with file tools only (no commands); changed files come back with the reply."}
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
