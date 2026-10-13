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
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";

// Icons live here rather than in the catalog so `core/modules` stays free of
// component imports (it is pure data + logic, unit-tested without React).
// The desktop sidebar and the phone drawer draw the same module the same way.
export const MODULE_ICONS: Record<
  string,
  ComponentType<SVGProps<SVGSVGElement>>
> = {
  hr: StoreIcon,
  assistant: UserRoundPenIcon,
  intelligence: RssIcon,
  "paper.trading": CandlestickChartIcon,
  projects: SquareKanbanIcon,
  design: WorkflowIcon,
  narrative: BookOpenIcon,
  evolution: DnaIcon,
  community: CompassIcon,
  mail: MailIcon,
  knowledge: DatabaseIcon,
  "library.apps": AppWindowIcon,
  "library.docs": FileTextIcon,
  "library.images": FileImageIcon,
  "library.videos": FilmIcon,
  "library.computer": HardDriveIcon,
};
