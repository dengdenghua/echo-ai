import { useQueryClient } from "@tanstack/react-query";
import {
  CheckIcon,
  ChevronRightIcon,
  CloudIcon,
  KeyRoundIcon,
  LaptopIcon,
  PlusIcon,
  RadioTowerIcon,
  SquareTerminalIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { RemoteConnectionDialog } from "@/components/workspace/remote-connection-dialog";
import { RemoteControlGuideDialog } from "@/components/workspace/remote-control-guide-dialog";
import {
  LOCAL_WORK_LOCATION,
  useWorkLocations,
  type RemoteConnection,
  type RemoteTransport,
  type WorkLocation,
} from "@/core/execution/work-location";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

/** A conversation's work location and how to change it. */
export interface WorkLocationBinding {
  value: WorkLocation;
  onChange: (location: WorkLocation) => void;
}

type Category = "local" | "node" | "wsl" | "ssh";
type DialogState =
  | { kind: "ssh" }
  | { kind: "wsl"; distro?: string }
  | { kind: "guide" }
  | null;

function categoryOf(location: WorkLocation): Category {
  if (location.kind === "node") return "node";
  if (location.kind === "remote")
    return location.transport === "wsl" ? "wsl" : "ssh";
  return "local";
}

/** Laptop for this computer; any other icon means the turn runs elsewhere. */
export function WorkLocationIcon({
  location,
  className,
}: {
  location: WorkLocation;
  className?: string;
}) {
  const category = categoryOf(location);
  const Icon =
    category === "node"
      ? RadioTowerIcon
      : category === "wsl"
        ? SquareTerminalIcon
        : category === "ssh"
          ? KeyRoundIcon
          : LaptopIcon;
  return <Icon className={className} aria-hidden="true" />;
}

const ROW =
  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:pointer-events-none disabled:opacity-50";

/**
 * The location half of the composer's location/address control.
 *
 * Owns the location data, the inline menu section and the add-connection
 * dialogs (which outlive the popover). ``label`` is ``null`` for this
 * computer so the caller shows its own address (the chosen folder).
 */
export function useWorkLocationMenu(
  binding: WorkLocationBinding | undefined,
  menuOpen: boolean,
) {
  const { locale } = useI18n();
  const zh = locale.startsWith("zh");
  const queryClient = useQueryClient();
  const value = binding?.value ?? LOCAL_WORK_LOCATION;
  const [dialog, setDialog] = useState<DialogState>(null);
  const [expanded, setExpanded] = useState<Category | null>(categoryOf(value));
  // Re-open on the current location's branch each time the menu opens.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (menuOpen && !wasOpen.current) setExpanded(categoryOf(value));
    wasOpen.current = menuOpen;
  }, [menuOpen, value]);

  const locations = useWorkLocations(
    Boolean(binding) && (menuOpen || value.kind !== "local"),
  );
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
  const label =
    value.kind === "node"
      ? currentNode?.label || value.label || value.node_id
      : value.kind === "remote"
        ? currentConnection?.name ||
          value.label ||
          (value.transport === "wsl" ? "WSL" : "SSH")
        : null;
  const detail =
    value.kind === "node"
      ? (value.workspace_name ?? value.workspace_id)
      : value.kind === "remote"
        ? currentConnection?.target
        : undefined;
  const unhealthy =
    (value.kind === "node" &&
      currentNode !== undefined &&
      !currentNode.online) ||
    (value.kind === "remote" && currentConnection?.health === "error");

  const chooseConnection = (connection: {
    id: string;
    name: string;
    transport: RemoteTransport;
  }) =>
    binding?.onChange({
      kind: "remote",
      backend_id: connection.id,
      transport: connection.transport,
      label: connection.name,
    });

  const renderSection = ({
    localContent,
    close,
  }: {
    localContent: ReactNode;
    close: () => void;
  }) => {
    if (!binding) return localContent;
    const pick = (location: WorkLocation) => {
      binding.onChange(location);
      close();
    };
    const openDialog = (next: DialogState) => {
      close();
      setDialog(next);
    };
    const toggle = (category: Category) =>
      setExpanded((current) => (current === category ? null : category));
    const note = (text: string, tone: "muted" | "error" = "muted") => (
      <p
        className={cn(
          "px-2 py-1.5 text-xs leading-relaxed",
          tone === "error" ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {text}
      </p>
    );
    const pending = locations.isLoading
      ? note(zh ? "正在查找…" : "Looking…")
      : locations.isError
        ? note(
            zh ? "暂时无法读取工作位置" : "Work locations are unavailable",
            "error",
          )
        : null;
    const remoteBlocked = !data
      ? null
      : !data.remote.enabled
        ? note(
            zh
              ? "远程连接尚未开启：需要开启实验功能 ui.remote_transport。"
              : "Remote connections are off: enable the experimental ui.remote_transport flag.",
          )
        : !data.remote.can_manage
          ? note(
              zh
                ? "只有管理员可以配置远程连接。"
                : "Only admins can configure remote connections.",
            )
          : null;
    const entry = ({
      key,
      title,
      subtitle,
      selected,
      disabled,
      danger,
      onClick,
    }: {
      key: string;
      title: string;
      subtitle?: string;
      selected: boolean;
      disabled?: boolean;
      danger?: boolean;
      onClick: () => void;
    }) => (
      <button
        key={key}
        type="button"
        disabled={disabled}
        aria-pressed={selected}
        onClick={onClick}
        className={cn(
          ROW,
          "items-start",
          selected && "bg-muted/60 text-foreground",
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 truncate text-foreground">
            {title}
            {danger ? (
              <span
                className="size-1.5 shrink-0 rounded-full bg-destructive"
                aria-hidden="true"
              />
            ) : null}
          </span>
          {subtitle ? (
            <span className="mt-0.5 block truncate font-normal text-muted-foreground">
              {subtitle}
            </span>
          ) : null}
        </span>
        {selected ? (
          <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-primary" />
        ) : null}
      </button>
    );
    const action = (key: string, text: string, onClick: () => void) => (
      <button key={key} type="button" onClick={onClick} className={ROW}>
        <PlusIcon className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{text}</span>
      </button>
    );
    const connectionEntry = (connection: RemoteConnection) =>
      entry({
        key: connection.id,
        title: connection.name,
        subtitle:
          connection.health === "error" && connection.health_detail
            ? connection.health_detail
            : connection.target,
        selected: value.kind === "remote" && value.backend_id === connection.id,
        danger: connection.health === "error",
        onClick: () => {
          chooseConnection(connection);
          close();
        },
      });
    const branch = (
      category: Category,
      icon: ReactNode,
      text: string,
      body: ReactNode,
    ) => {
      const open = expanded === category;
      const active = categoryOf(value) === category;
      return (
        <div key={category}>
          <button
            type="button"
            aria-expanded={open}
            data-testid={`work-location-${category}`}
            onClick={() => {
              if (category === "local" && value.kind !== "local")
                binding.onChange(LOCAL_WORK_LOCATION);
              toggle(category);
            }}
            className={cn(ROW, active && "text-foreground")}
          >
            {icon}
            <span className="min-w-0 flex-1 truncate">{text}</span>
            {active && !open ? (
              <span
                className="size-1.5 shrink-0 rounded-full bg-primary"
                aria-hidden="true"
              />
            ) : null}
            <ChevronRightIcon
              className={cn(
                "size-3.5 shrink-0 opacity-50 transition-transform",
                open && "rotate-90",
              )}
            />
          </button>
          {open ? (
            <div className="ml-3 border-l border-border/60 pl-1">{body}</div>
          ) : null}
        </div>
      );
    };

    const nodeEntries = nodes.flatMap((node) =>
      node.workspaces.flatMap((workspace) =>
        node.roles.map((role) => {
          const offline = !node.online;
          const unmounted = !workspace.ready;
          const scope =
            node.roles.length > 1
              ? `${workspace.name} · ${role}`
              : workspace.name;
          return entry({
            key: `${node.node_id}:${workspace.id}:${role}`,
            title: node.label,
            subtitle: offline
              ? zh
                ? "离线"
                : "Offline"
              : unmounted
                ? zh
                  ? "共享空间未挂载到本机"
                  : "Workspace is not mounted here"
                : scope,
            selected:
              value.kind === "node" &&
              value.node_id === node.node_id &&
              value.workspace_id === workspace.id &&
              value.role === role,
            disabled: offline || unmounted,
            onClick: () =>
              pick({
                kind: "node",
                node_id: node.node_id,
                workspace_id: workspace.id,
                role,
                label: node.label,
                workspace_name: workspace.name,
              }),
          });
        }),
      ),
    );

    return (
      <div className="p-1.5" data-testid="work-location-menu">
        {branch(
          "local",
          <LaptopIcon className="size-3.5 shrink-0" />,
          zh ? "本地" : "Local",
          localContent,
        )}
        <button
          type="button"
          disabled
          className={ROW}
          data-testid="work-location-cloud"
        >
          <CloudIcon className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            {zh ? "云端" : "Cloud"}
          </span>
          <span className="shrink-0 text-xs font-normal">
            {zh ? "即将推出" : "Coming soon"}
          </span>
        </button>
        {branch(
          "node",
          <RadioTowerIcon className="size-3.5 shrink-0" />,
          zh ? "远程控制" : "Remote Control",
          <>
            {pending ??
              (nodeEntries.length > 0
                ? nodeEntries
                : note(
                    zh
                      ? "还没有连上来的机器。"
                      : "No machines are connected yet.",
                  ))}
            {action(
              "guide",
              zh ? "连接另一台机器…" : "Connect another machine…",
              () => openDialog({ kind: "guide" }),
            )}
          </>,
        )}
        {showWsl
          ? branch(
              "wsl",
              <SquareTerminalIcon className="size-3.5 shrink-0" />,
              "WSL",
              pending ?? remoteBlocked ?? (
                <>
                  {wslConnections.map(connectionEntry)}
                  {unconnectedDistros.map((distro) =>
                    action(
                      distro.name,
                      zh ? `连接 ${distro.name}…` : `Connect ${distro.name}…`,
                      () => openDialog({ kind: "wsl", distro: distro.name }),
                    ),
                  )}
                </>
              ),
            )
          : null}
        {branch(
          "ssh",
          <KeyRoundIcon className="size-3.5 shrink-0" />,
          "SSH",
          pending ?? remoteBlocked ?? (
            <>
              {sshConnections.map(connectionEntry)}
              {action(
                "add-ssh",
                zh ? "添加 SSH 连接…" : "Add SSH connection…",
                () => openDialog({ kind: "ssh" }),
              )}
            </>
          ),
        )}
      </div>
    );
  };

  const dialogs = binding ? (
    <>
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
  ) : null;

  return { value, label, detail, unhealthy, renderSection, dialogs };
}
