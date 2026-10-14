import {
  AppWindowIcon,
  BookOpenIcon,
  CandlestickChartIcon,
  CompassIcon,
  DatabaseIcon,
  DnaIcon,
  FileImageIcon,
  FileTextIcon,
  FilmIcon,
  HardDriveIcon,
  MailIcon,
  RssIcon,
  SquareKanbanIcon,
  StoreIcon,
  UserRoundPenIcon,
  WorkflowIcon,
  type LucideIcon,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";

import type { WorkbenchBuiltinIcon } from "@/core/workbench/apps";

// One icon per workbench app wherever it is drawn: the sidebar, the phone
// drawer, HUB 应用, the browser home and the desktop launcher. Each surface
// used to keep its own map, so 设计画布 was a workflow, a palette or a photo
// depending on where you looked, and the launcher drew two apps per glyph.
export const WORKBENCH_APP_ICONS = {
  projects: SquareKanbanIcon,
  trading: CandlestickChartIcon,
  design: WorkflowIcon,
  narrative: BookOpenIcon,
  evolution: DnaIcon,
  intelligence: RssIcon,
  community: CompassIcon,
  mail: MailIcon,
} satisfies Record<WorkbenchBuiltinIcon, LucideIcon>;

// Icons live here rather than in the catalog so `core/modules` stays free of
// component imports (it is pure data + logic, unit-tested without React).
// The desktop sidebar and the phone drawer draw the same module the same way.
export const MODULE_ICONS: Record<
  string,
  ComponentType<SVGProps<SVGSVGElement>>
> = {
  hr: StoreIcon,
  assistant: UserRoundPenIcon,
  intelligence: WORKBENCH_APP_ICONS.intelligence,
  "paper.trading": WORKBENCH_APP_ICONS.trading,
  projects: WORKBENCH_APP_ICONS.projects,
  design: WORKBENCH_APP_ICONS.design,
  narrative: WORKBENCH_APP_ICONS.narrative,
  evolution: WORKBENCH_APP_ICONS.evolution,
  community: WORKBENCH_APP_ICONS.community,
  mail: WORKBENCH_APP_ICONS.mail,
  knowledge: DatabaseIcon,
  "library.apps": AppWindowIcon,
  "library.docs": FileTextIcon,
  "library.images": FileImageIcon,
  "library.videos": FilmIcon,
  "library.computer": HardDriveIcon,
};
