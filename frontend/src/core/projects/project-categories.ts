import type { ProjectIconId } from "./project-icons";

/** The labels a category id is shown with (`t.createProjectDialog`). */
export interface ProjectCategoryCopy {
  categoryInvest: string;
  categoryHomework: string;
  categoryWriting: string;
  categoryTravel: string;
}

/** Quick categories in 新建项目; picking one also picks its line icon. */
export const PROJECT_CATEGORY_PRESETS = [
  { category: "investment", icon: "trending-up", labelKey: "categoryInvest" },
  { category: "homework", icon: "notebook-pen", labelKey: "categoryHomework" },
  { category: "writing", icon: "pen-line", labelKey: "categoryWriting" },
  { category: "travel", icon: "plane", labelKey: "categoryTravel" },
] as const satisfies readonly {
  category: string;
  icon: ProjectIconId;
  labelKey: keyof ProjectCategoryCopy;
}[];

/**
 * The label for a stored category: preset ids are translated, any other
 * label the backend kept is shown as is, and no category gives `null`.
 */
export function projectCategoryLabel(
  category: string | null | undefined,
  copy: ProjectCategoryCopy,
): string | null {
  const value = category?.trim() ?? "";
  if (!value) return null;
  const preset = PROJECT_CATEGORY_PRESETS.find(
    (item) => item.category === value,
  );
  return preset ? copy[preset.labelKey] : value;
}
