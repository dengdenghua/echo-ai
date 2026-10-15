import { CircleAlertIcon, RefreshCwIcon } from "lucide-react";

/** The crashed-tab mark: a line icon, never an emoji (ECHO draws no emoji). */
export function CrashGlyph({ recovering }: { recovering?: boolean }) {
  return recovering ? (
    <RefreshCwIcon className="size-8 text-muted-foreground" />
  ) : (
    <CircleAlertIcon className="size-8 text-destructive" />
  );
}
