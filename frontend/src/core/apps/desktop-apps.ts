import { MailIcon } from "lucide-react";
import {
  AppWindowIcon,
  FileImageIcon,
  FileTextIcon,
  FilmIcon,
  FolderIcon,
  GlobeIcon,
  MonitorIcon,
  MonitorSmartphoneIcon,
  SettingsIcon,
  SparklesIcon,
  TerminalSquareIcon,
  type LucideIcon,
} from "lucide-react";

import {
  WORKBENCH_BUILTIN_APPS,
  type WorkbenchBuiltinApp,
} from "@/core/workbench/apps";
import type { Translations } from "@/core/i18n/locales";
import { BROWSER_WORKSPACE_ROUTE } from "@/core/workspace/sidebar-routing";

export type DesktopAppPlacement =
  | "primary"
  | "library"
  | "system"
  | "workbench";

export interface DesktopApp {
  id: string;
  name: string;
  subtitle: string;
  route: string;
  icon: LucideIcon;
  placement: DesktopAppPlacement;
}

const WORKBENCH_ICONS: Record<WorkbenchBuiltinApp["icon"], LucideIcon> = {
  projects: FolderIcon,
  trading: SparklesIcon,
  design: FileImageIcon,
  narrative: FileTextIcon,
  evolution: SparklesIcon,
  intelligence: GlobeIcon,
  community: AppWindowIcon,
  mail: MailIcon,
};

function workbenchDesktopApp(app: WorkbenchBuiltinApp): DesktopApp {
  return {
    id: `workbench:${app.id}`,
    name: app.name,
    subtitle: app.description,
    route: app.workspaceRoute,
    icon: WORKBENCH_ICONS[app.icon],
    placement: "workbench",
  };
}

/**
 * The single desktop-facing catalog. Pages keep their existing routes and
 * backend contracts; this layer only gives them a stable app identity and
 * launch metadata.
 */
export function buildDesktopApps(t: Translations): DesktopApp[] {
  const apps: DesktopApp[] = [
    {
      id: "devices",
      name: "设备互联",
      subtitle: "电脑与手机 · 同屏与文件收发",
      route: "/workspace/devices",
      icon: MonitorSmartphoneIcon,
      placement: "primary",
    },
    {
      id: "workspace",
      name: t.desktop.apps.workspace.name,
      subtitle: t.desktop.apps.workspace.subtitle,
      route: "/workspace/realtime/new",
      icon: MonitorIcon,
      placement: "primary",
    },
    {
      id: "ai-browser",
      name: t.desktop.apps.aiBrowser.name,
      subtitle: t.desktop.apps.aiBrowser.subtitle,
      route: BROWSER_WORKSPACE_ROUTE,
      icon: GlobeIcon,
      placement: "primary",
    },
    {
      id: "local-files",
      name: t.desktop.apps.localFiles.name,
      subtitle: t.desktop.apps.localFiles.subtitle,
      route: "/workspace/knowledge",
      icon: FolderIcon,
      placement: "primary",
    },
    {
      id: "photos",
      name: t.storage.libraries.imagesLabel,
      subtitle: t.storage.libraries.imagesDetail,
      route: "/apps/photos",
      icon: FileImageIcon,
      placement: "library",
    },
    {
      id: "media",
      name: t.storage.libraries.videosLabel,
      subtitle: t.storage.libraries.videosDetail,
      route: "/apps/media",
      icon: FilmIcon,
      placement: "library",
    },
    {
      id: "local-apps",
      name: t.desktop.apps.localApps.name,
      subtitle: t.desktop.apps.localApps.subtitle,
      route: "/workspace/agents?surface=chat&tab=plugins",
      icon: AppWindowIcon,
      placement: "library",
    },
    {
      id: "terminal-logs",
      name: t.desktop.apps.terminalLogs.name,
      subtitle: t.desktop.apps.terminalLogs.subtitle,
      route: "/workspace/observability",
      icon: TerminalSquareIcon,
      placement: "system",
    },
    {
      id: "settings",
      name: t.desktop.apps.settings.name,
      subtitle: t.desktop.apps.settings.subtitle,
      route: "/workspace/settings",
      icon: SettingsIcon,
      placement: "system",
    },
  ];

  return [...apps, ...WORKBENCH_BUILTIN_APPS.map(workbenchDesktopApp)];
}

/** URL understood by the packaged Electron shell's auxiliary-window handler. */
export function desktopWindowURL(route: string): string {
  const normalized = route.startsWith("/") ? route : `/${route}`;
  const separator = normalized.includes("?") ? "&" : "?";
  return `echo-app://app/index.html#${normalized}${separator}embedded=app`;
}

export function shouldOpenDesktopWindow(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean(window.echo?.isElectron) &&
    window.location.protocol === "echo-app:"
  );
}
