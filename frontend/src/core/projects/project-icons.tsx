import {
  FolderIcon,
  NotebookPenIcon,
  PenLineIcon,
  PlaneIcon,
  TrendingUpIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

/** Project icons are stored as ids and drawn as line icons (brand: no emoji). */
const PROJECT_ICONS = {
  folder: FolderIcon,
  "trending-up": TrendingUpIcon,
  "notebook-pen": NotebookPenIcon,
  "pen-line": PenLineIcon,
  plane: PlaneIcon,
} satisfies Record<string, LucideIcon>;

export type ProjectIconId = keyof typeof PROJECT_ICONS;

export const DEFAULT_PROJECT_ICON: ProjectIconId = "folder";

// Projects created before icon ids stored the emoji itself.
const LEGACY_EMOJI_ICONS: Record<string, ProjectIconId> = {
  "📁": "folder",
  "📂": "folder",
  "📋": "folder",
  "📈": "trending-up",
  "📝": "notebook-pen",
  "✍️": "pen-line",
  "✍": "pen-line",
  "✈️": "plane",
  "✈": "plane",
};

function isProjectIconId(value: string): value is ProjectIconId {
  return Object.hasOwn(PROJECT_ICONS, value);
}

/** Resolve a stored icon (id, legacy emoji or nothing) to a known id. */
export function projectIconId(value: string | null | undefined): ProjectIconId {
  const stored = value?.trim() ?? "";
  if (isProjectIconId(stored)) return stored;
  return LEGACY_EMOJI_ICONS[stored] ?? DEFAULT_PROJECT_ICON;
}

export function ProjectIcon({
  icon,
  className,
}: {
  icon: string | null | undefined;
  className?: string;
}) {
  const Icon = PROJECT_ICONS[projectIconId(icon)];
  return (
    <Icon
      aria-hidden
      strokeWidth={1.5}
      className={cn("size-3.5 shrink-0", className)}
    />
  );
}
