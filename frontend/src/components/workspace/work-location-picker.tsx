import { useQueryClient } from "@tanstack/react-query";
import {
  CheckIcon,
  ChevronDownIcon,
  CloudIcon,
  KeyRoundIcon,
  LaptopIcon,
  PlusIcon,
  RadioTowerIcon,
  SquareTerminalIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

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
import { RemoteConnectionDialog } from "@/components/workspace/remote-connection-dialog";
import { RemoteControlGuideDialog } from "@/components/workspace/remote-control-guide-dialog";
import {
  LOCAL_WORK_LOCATION,
  useWorkLocations,
  type ExecutionNodeLocation,
  type RemoteConnection,
  type RemoteTransport,
  type WorkLocation,
} from "@/core/execution/work-location";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

type DialogState =
  | { kind: "ssh" }
  | { kind: "wsl"; distro?: string }
  | { kind: "guide" }
  | null;

function Note({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "error";
}) {
  return (
    <p
      className={cn(
        "max-w-64 px-2 py-1.5 text-xs leading-relaxed",
        tone === "error" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {children}
    </p>
  );
}

function Check({ on }: { on: boolean }) {
  return on ? (
    <CheckIcon className="ml-auto size-4 shrink-0 text-primary" />
  ) : null;
}

function locationIcon(location: WorkLocation, className: string) {
  if (location.kind === "node") return <RadioTowerIcon className={className} />;
  if (location.kind === "remote") {
    return location.transport === "wsl" ? (
      <SquareTerminalIcon className={className} />
    ) : (
      <KeyRoundIcon className={className} />
    );
  }
  return <LaptopIcon className={className} />;
}

/**
 * Where this conversation's turns run: this computer, another machine that
 * connected as an execution node (remote control), WSL, or an SSH host.
 */
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
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  // Fetch once the user looks, and keep a non-local selection's status fresh.
  const locations = useWorkLocations(open || value.kind !== "local");
  const data = locations.data;
  const nodes = data?.execution_nodes ?? [];
  const connections = data?.remote.connections ?? [];
  const sshConnections = connections.filter(
    (c) => c.transport === "ssh_tunnel",
  );
  const wslConnections = connections.filter((c) => c.transport === "wsl");
  const distros = data?.wsl.distros ?? [];
  const unconnectedDistros = distros.filter(
    (d) => !wslConnections.some((c) => c.target === d.name),
  );
  const showWsl = Boolean(data?.wsl.available) || wslConnections.length > 0;

  const currentNode =
    value.kind === "node"
      ? nodes.find((node) => node.node_id === value.node_id)
      : undefined;
  const currentConnection =
    value.kind === "remote"
      ? connections.find((c) => c.id === value.backend_id)
      : undefined;
  const triggerLabel =
    value.kind === "node"
      ? currentNode?.label || value.label || value.node_id
      : value.kind === "remote"
        ? currentConnection?.name ||
          value.label ||
          (value.transport === "wsl" ? "WSL" : "SSH")
        : zh
          ? "本地"
          : "Local";
  const unhealthy =
    (value.kind === "node" &&
      currentNode !== undefined &&
      !currentNode.online) ||
    (value.kind === "remote" && currentConnection?.health === "error");
  const title = zh ? "工作位置" : "Work location";

  const chooseNode = (
    node: ExecutionNodeLocation,
    workspace: { id: string; name: string },
    role: string,
  ) =>
    onChange({
      kind: "node",
      node_id: node.node_id,
      workspace_id: workspace.id,
      role,
      label: node.label,
      workspace_name: workspace.name,
    });
  const chooseConnection = (connection: {
    id: string;
    name: string;
    transport: RemoteTransport;
  }) =>
    onChange({
      kind: "remote",
      backend_id: connection.id,
      transport: connection.transport,
      label: connection.name,
    });
  const isConnection = (id: string) =>
    value.kind === "remote" && value.backend_id === id;

  const remoteUnavailable = !data ? null : !data.remote.enabled ? (
    <Note>
      {zh
        ? "远程连接尚未开启：需要开启实验功能 ui.remote_transport。"
        : "Remote connections are off: enable the experimental ui.remote_transport flag."}
    </Note>
  ) : !data.remote.can_manage ? (
    <Note>
      {zh
        ? "只有管理员可以配置远程连接。"
        : "Only admins can configure remote connections."}
    </Note>
  ) : null;

  const connectionItem = (connection: RemoteConnection) => (
    <DropdownMenuItem
      key={connection.id}
      onSelect={() => chooseConnection(connection)}
      className="items-start gap-2.5 py-2"
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 truncate font-medium">
          {connection.name}
          {connection.health === "error" ? (
            <span
              className="size-1.5 shrink-0 rounded-full bg-destructive"
              aria-hidden="true"
            />
          ) : null}
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {connection.health === "error" && connection.health_detail
            ? connection.health_detail
            : connection.target}
        </span>
      </span>
      <Check on={isConnection(connection.id)} />
    </DropdownMenuItem>
  );

  const nodeItems = nodes.flatMap((node) =>
    node.workspaces.map((workspace) => {
      const unavailable = !node.online || !workspace.ready;
      const hint = !node.online
        ? zh
          ? "离线"
          : "Offline"
        : !workspace.ready
          ? zh
            ? "共享空间未挂载到本机"
            : "Workspace is not mounted here"
          : workspace.name;
      const selected =
        value.kind === "node" &&
        value.node_id === node.node_id &&
        value.workspace_id === workspace.id;
      const body = (
        <>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{node.label}</span>
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {hint}
            </span>
          </span>
          <Check on={selected} />
        </>
      );
      const key = `${node.node_id}:${workspace.id}`;
      if (node.roles.length > 1 && !unavailable) {
        return (
          <DropdownMenuSub key={key}>
            <DropdownMenuSubTrigger className="items-start gap-2.5 py-2">
              {body}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-48">
              <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
                {zh ? "由哪个角色执行" : "Run as role"}
              </DropdownMenuLabel>
              {node.roles.map((role) => (
                <DropdownMenuItem
                  key={role}
                  onSelect={() => chooseNode(node, workspace, role)}
                >
                  <span className="flex-1 truncate">{role}</span>
                  <Check
                    on={
                      selected && value.kind === "node" && value.role === role
                    }
                  />
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
          onSelect={() => chooseNode(node, workspace, node.roles[0]!)}
          className="items-start gap-2.5 py-2"
        >
          {body}
        </DropdownMenuItem>
      );
    }),
  );

  const loadingOrError = locations.isLoading ? (
    <Note>{zh ? "正在查找…" : "Looking…"}</Note>
  ) : locations.isError ? (
    <Note tone="error">
      {zh ? "暂时无法读取工作位置" : "Work locations are unavailable"}
    </Note>
  ) : null;

  const subTrigger = (
    icon: ReactNode,
    label: string,
    active: boolean,
    testId: string,
  ) => (
    <DropdownMenuSubTrigger className="gap-2.5 py-1.5" data-testid={testId}>
      {icon}
      <span className="flex-1">{label}</span>
      {active ? (
        <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
      ) : null}
    </DropdownMenuSubTrigger>
  );

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label={`${title}: ${triggerLabel}`}
            title={
              value.kind === "node"
                ? `${title}: ${triggerLabel} · ${value.workspace_name ?? value.workspace_id}`
                : `${title}: ${triggerLabel}`
            }
            data-testid="work-location-trigger"
            className={cn(
              "group flex h-8 max-w-[160px] items-center gap-1.5 rounded-lg px-1.5 text-ui font-medium text-muted-foreground transition-colors hover:bg-muted/55 hover:text-foreground disabled:opacity-50",
              value.kind !== "local" && "text-foreground",
            )}
          >
            {locationIcon(value, "size-3.5 shrink-0")}
            <span className="truncate">{triggerLabel}</span>
            {unhealthy ? (
              <span
                className="size-1.5 shrink-0 rounded-full bg-destructive"
                aria-hidden="true"
              />
            ) : null}
            <ChevronDownIcon className="size-3 shrink-0 opacity-60" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-52"
          data-testid="work-location-menu"
        >
          <DropdownMenuItem
            onSelect={() => onChange(LOCAL_WORK_LOCATION)}
            className="gap-2.5 py-1.5"
          >
            <LaptopIcon className="size-4 shrink-0" />
            <span className="flex-1">{zh ? "本地" : "Local"}</span>
            <Check on={value.kind === "local"} />
          </DropdownMenuItem>

          <DropdownMenuSub>
            {subTrigger(
              <CloudIcon className="size-4 shrink-0" />,
              zh ? "云端" : "Cloud",
              false,
              "work-location-cloud",
            )}
            <DropdownMenuSubContent className="w-64">
              <DropdownMenuItem disabled className="items-start py-2">
                <span className="min-w-0">
                  <span className="block font-medium">
                    {zh ? "即将推出" : "Coming soon"}
                  </span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                    {zh
                      ? "在云端沙箱里运行，不占用这台电脑。需要 Echo 云服务。"
                      : "Run in a cloud sandbox without using this computer. Needs the Echo cloud service."}
                  </span>
                </span>
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSub>
            {subTrigger(
              <RadioTowerIcon className="size-4 shrink-0" />,
              zh ? "远程控制" : "Remote Control",
              value.kind === "node",
              "work-location-remote-control",
            )}
            <DropdownMenuSubContent className="w-64">
              {loadingOrError ??
                (nodeItems.length > 0 ? (
                  nodeItems
                ) : (
                  <Note>
                    {zh
                      ? "还没有连上来的机器。"
                      : "No machines are connected yet."}
                  </Note>
                ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => setDialog({ kind: "guide" })}
                className="gap-2.5"
              >
                <PlusIcon className="size-4 shrink-0" />
                {zh ? "连接另一台机器…" : "Connect another machine…"}
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          {showWsl ? (
            <DropdownMenuSub>
              {subTrigger(
                <SquareTerminalIcon className="size-4 shrink-0" />,
                "WSL",
                value.kind === "remote" && value.transport === "wsl",
                "work-location-wsl",
              )}
              <DropdownMenuSubContent className="w-64">
                {loadingOrError ?? remoteUnavailable ?? (
                  <>
                    {wslConnections.map(connectionItem)}
                    {wslConnections.length > 0 &&
                    unconnectedDistros.length > 0 ? (
                      <DropdownMenuSeparator />
                    ) : null}
                    {unconnectedDistros.map((distro) => (
                      <DropdownMenuItem
                        key={distro.name}
                        onSelect={() =>
                          setDialog({ kind: "wsl", distro: distro.name })
                        }
                        className="gap-2.5"
                      >
                        <PlusIcon className="size-4 shrink-0" />
                        <span className="truncate">
                          {zh
                            ? `连接 ${distro.name}…`
                            : `Connect ${distro.name}…`}
                        </span>
                      </DropdownMenuItem>
                    ))}
                  </>
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : null}

          <DropdownMenuSub>
            {subTrigger(
              <KeyRoundIcon className="size-4 shrink-0" />,
              "SSH",
              value.kind === "remote" && value.transport === "ssh_tunnel",
              "work-location-ssh",
            )}
            <DropdownMenuSubContent className="w-64">
              {loadingOrError ?? remoteUnavailable ?? (
                <>
                  {sshConnections.map(connectionItem)}
                  {sshConnections.length > 0 ? <DropdownMenuSeparator /> : null}
                  <DropdownMenuItem
                    onSelect={() => setDialog({ kind: "ssh" })}
                    className="gap-2.5"
                  >
                    <PlusIcon className="size-4 shrink-0" />
                    {zh ? "添加 SSH 连接…" : "Add SSH connection…"}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>

      <RemoteConnectionDialog
        open={dialog?.kind === "ssh" || dialog?.kind === "wsl"}
        onOpenChange={(next) => {
          if (!next) setDialog(null);
        }}
        transport={dialog?.kind === "wsl" ? "wsl" : "ssh_tunnel"}
        distros={distros}
        initialDistro={dialog?.kind === "wsl" ? dialog.distro : undefined}
        onAdded={(connection) => {
          chooseConnection(connection);
          void queryClient.invalidateQueries({
            queryKey: ["execution", "locations"],
          });
        }}
      />
      <RemoteControlGuideDialog
        open={dialog?.kind === "guide"}
        onOpenChange={(next) => {
          if (!next) setDialog(null);
        }}
      />
    </>
  );
}
