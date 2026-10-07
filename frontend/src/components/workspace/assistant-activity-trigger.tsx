import { useRef, useState } from "react";
import { ActivityIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/core/i18n/hooks";
import { useAssistantActivityScope } from "@/core/assistant/activity";

import { AssistantActivityPanel } from "./assistant-activity-panel";

export function AssistantActivityTrigger() {
  const { locale } = useI18n();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const { queryKey } = useAssistantActivityScope();
  const label = locale.startsWith("zh") ? "助手活动" : "Assistant activity";

  return (
    <>
      <Button
        ref={trigger}
        variant="ghost"
        size="sm"
        className="h-[42px] min-w-[42px] gap-1.5 px-2 text-xs text-muted-foreground sm:h-8 sm:min-w-0"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={label}
        onClick={() => setOpen(true)}
      >
        <ActivityIcon className="size-3.5" aria-hidden="true" />
        <span className="hidden sm:inline">
          {locale.startsWith("zh") ? "活动" : "Activity"}
        </span>
      </Button>
      <AssistantActivityPanel
        key={JSON.stringify(queryKey)}
        open={open}
        onOpenChange={setOpen}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          trigger.current?.focus();
        }}
      />
    </>
  );
}
