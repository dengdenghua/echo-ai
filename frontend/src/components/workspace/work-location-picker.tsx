import { useQueryClient } from "@tanstack/react-query";
import {
  CheckIcon,
  KeyRoundIcon,
  LaptopIcon,
  PlusIcon,
  RadioTowerIcon,
  SquareTerminalIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { AddConnectionDialog } from "@/components/workspace/remote-connection-dialog";
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

function categoryOf(location: WorkLocation): Category {
  if (location.kind === "node") return "node";
  if (location.kind === "remote") {
    return location.transport === "wsl" ? "wsl" : "ssh";
  }
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

/** Keep a path's head and tail — the tail names the folder: ``C:/…/proj/src``. */
export function shortenPath(path: string, max = 34): string {
  if (path.length <= max) return path;
  const sep = path.includes("\\") && !path.includes("/") ? "\\" : "/";
  const parts = path.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 3) return `…${path.slice(-(max - 1))}`;
  const head = /^[A-Za-z]:$/.test(parts[0]!)
    ? parts[0]!
    : `${path.startsWith(sep) ? sep : ""}${parts[0]}`;
  const tail = parts.slice(-2).join(sep);
  const short = `${head}${sep}…${sep}${tail}`;
  return short.length <= max + 6 ? short : `…${sep}${parts[parts.length - 1]}`;
}

// ── Menu items shared by every submenu, including the local folders ──

const ITEM = "gap-2 rounded-md px-2 py-1.5 text-xs";

/** A choosable address: a folder, a node, a connection. */
export function LocationItem({
  icon,
  title,
  subtitle,
  selected,
  disabled,
  danger,
  hint,
  onSelect,
}: {
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  selected?: boolean;
  disabled?: boolean;
  danger?: boolean;
  /** Native tooltip, e.g. the full path. */
  hint?: string;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem
      disabled={disabled}
      title={hint}
      onSelect={onSelect}
      className={cn(ITEM, subtitle && "items-start")}
    >
      {icon ? (
        <span className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground">
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "flex items-center gap-1.5 truncate",
            selected && "font-medium",
          )}
        >
          <span className="truncate">{title}</span>
          {danger ? (
            <span
              className="size-1.5 shrink-0 rounded-full bg-destructive"
              aria-hidden="true"
            />
          ) : null}
        </span>
        {subtitle ? (
          <span className="mt-0.5 block truncate text-muted-foreground">
            {subtitle}
          </span>
        ) : null}
      </span>
      {selected ? (
        <CheckIcon className="size-3.5 shrink-0 text-primary" />
      ) : null}
    </DropdownMenuItem>
  );
}

/** "Add …" style item; ends a submenu. */
export function LocationAction({
  icon,
  children,
  disabled,
  onSelect,
}: {
  icon?: ReactNode;
  children: ReactNode;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem
      disabled={disabled}
      onSelect={onSelect}
      className={cn(ITEM, "text-muted-foreground")}
    >
      <span className="flex size-3.5 shrink-0 items-center justify-center">
        {icon ?? <PlusIcon className="size-3.5" />}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </DropdownMenuItem>
  );
}

export function LocationLabel({ children }: { children: ReactNode }) {
  return (
    <DropdownMenuLabel className="px-2 pb-0.5 pt-1.5 text-[11px] font-medium text-muted-foreground/80">
      {children}
    </DropdownMenuLabel>
  );
}

export function LocationNote({
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

export { DropdownMenuSeparator as LocationSeparator };

/**
 * The location half of the composer's location/address control.
 *
 * Owns the location data, the cascading menu items and the add-connection
 * dialogs (which outlive the menu). ``label`` is ``null`` for this computer
 * so the caller shows its own address (the chosen folder).
 */
export function useWorkLocationMenu(
  binding: WorkLocationBinding | undefined,
  menuOpen: boolean,
) {
  const { locale } = useI18n();
  const zh = locale.startsWith("zh");
  const queryClient = useQueryClient();
  const value = binding?.value ?? LOCAL_WORK_LOCATION;
  const [adding, setAdding] = useState(false);

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

  /**
   * Items for a ``DropdownMenuContent``: 本地, then only the kinds that have
   * somewhere to go, each a submenu; one "添加连接…" adds any kind.
   */
  const renderMenu = ({
    localItems,
    localSummary,
  }: {
    localItems: ReactNode;
    /** The chosen folder, shown beside "本地" while it is the location. */
    localSummary?: string;
  }) => {
    if (!binding) return localItems;

    const connectionItem = (connection: RemoteConnection) => (
      <LocationItem
        key={connection.id}
        title={connection.name}
        subtitle={
          connection.health === "error" && connection.health_detail
            ? connection.health_detail
            : connection.target
        }
        selected={value.kind === "remote" && value.backend_id === connection.id}
        danger={connection.health === "error"}
        onSelect={() => chooseConnection(connection)}
      />
    );

    const submenu = (
      category: Category,
      icon: ReactNode,
      text: string,
      body: ReactNode,
      summary?: string,
    ) => {
      const active = categoryOf(value) === category;
      return (
        <DropdownMenuSub key={category}>
          <DropdownMenuSubTrigger
            className={cn(
              ITEM,
              "font-medium",
              !active && "text-muted-foreground",
            )}
            data-testid={`work-location-${category}`}
          >
            <span className="flex size-3.5 shrink-0 items-center justify-center">
              {icon}
            </span>
            <span className="shrink-0">{text}</span>
            <span className="min-w-0 flex-1 truncate text-right font-normal text-muted-foreground">
              {active ? summary : null}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent
            className="w-72"
            data-testid={`work-location-${category}-menu`}
          >
            {body}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      );
    };

    const nodeItems = nodes.flatMap((node) =>
      node.workspaces.flatMap((workspace) =>
        node.roles.map((role) => {
          const offline = !node.online;
          const unmounted = !workspace.ready;
          const scope =
            node.roles.length > 1
              ? `${workspace.name} · ${role}`
              : workspace.name;
          return (
            <LocationItem
              key={`${node.node_id}:${workspace.id}:${role}`}
              title={node.label}
              subtitle={
                offline
                  ? zh
                    ? "离线"
                    : "Offline"
                  : unmounted
                    ? zh
                      ? "共享空间未挂载到本机"
                      : "Workspace is not mounted here"
                    : scope
              }
              selected={
                value.kind === "node" &&
                value.node_id === node.node_id &&
                value.workspace_id === workspace.id &&
                value.role === role
              }
              disabled={offline || unmounted}
              onSelect={() =>
                binding.onChange({
                  kind: "node",
                  node_id: node.node_id,
                  workspace_id: workspace.id,
                  role,
                  label: node.label,
                  workspace_name: workspace.name,
                })
              }
            />
          );
        }),
      ),
    );
    const missing = (
      <LocationNote>
        {locations.isLoading
          ? zh
            ? "正在查找…"
            : "Looking…"
          : zh
            ? "这个位置已不可用，请换一个"
            : "This location is no longer available"}
      </LocationNote>
    );
    // A selected location stays listed even while its kind is still loading.
    const show = (category: Category, count: number) =>
      count > 0 || categoryOf(value) === category;

    return (
      <div data-testid="work-location-menu">
        {submenu(
          "local",
          <LaptopIcon className="size-3.5" />,
          zh ? "本地" : "Local",
          localItems,
          localSummary,
        )}
        {show("node", nodeItems.length)
          ? submenu(
              "node",
              <RadioTowerIcon className="size-3.5" />,
              zh ? "远程控制" : "Remote Control",
              nodeItems.length > 0 ? nodeItems : missing,
              label ?? undefined,
            )
          : null}
        {show("wsl", wslConnections.length)
          ? submenu(
              "wsl",
              <SquareTerminalIcon className="size-3.5" />,
              "WSL",
              wslConnections.length > 0
                ? wslConnections.map(connectionItem)
                : missing,
              label ?? undefined,
            )
          : null}
        {show("ssh", sshConnections.length)
          ? submenu(
              "ssh",
              <KeyRoundIcon className="size-3.5" />,
              "SSH",
              sshConnections.length > 0
                ? sshConnections.map(connectionItem)
                : missing,
              label ?? undefined,
            )
          : null}
        <DropdownMenuSeparator />
        <LocationAction onSelect={() => setAdding(true)}>
          {zh ? "添加连接…" : "Add connection…"}
        </LocationAction>
      </div>
    );
  };

  const dialogs = binding ? (
    <AddConnectionDialog
      open={adding}
      onOpenChange={setAdding}
      distros={distros}
      remote={{
        enabled: Boolean(data?.remote.enabled),
        canManage: Boolean(data?.remote.can_manage),
      }}
      onAdded={(connection) => {
        chooseConnection(connection);
        void queryClient.invalidateQueries({
          queryKey: ["execution", "locations"],
        });
      }}
    />
  ) : null;

  return { value, label, detail, unhealthy, renderMenu, dialogs };
}
