import { lazy, Suspense } from "react";
import { MessageCircleIcon } from "lucide-react";
import { useSearchParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useI18n } from "@/core/i18n/hooks";

const ChannelsPage = lazy(() => import("@/app/workspace/channels/page"));

/** Message connections are configured within the persistent Assistant chat. */
export function AssistantChannels() {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const open = searchParams.get("assistantPanel") === "channels";
  const setOpen = (next: boolean) => {
    setSearchParams(
      (current) => {
        const params = new URLSearchParams(current);
        if (next) params.set("assistantPanel", "channels");
        else params.delete("assistantPanel");
        return params;
      },
      { replace: true },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-[42px] gap-1.5 px-2 sm:h-8"
          aria-label={t.channels.title}
          title={t.channels.title}
        >
          <MessageCircleIcon className="size-4" />
          <span className="hidden sm:inline">{t.channels.title}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="flex h-[90dvh] max-h-[900px] w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="sr-only">
          <DialogTitle>{t.channels.title}</DialogTitle>
          <DialogDescription>{t.channels.pageDescription}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 pt-9">
          <Suspense
            fallback={
              <div className="p-6 text-sm text-muted-foreground" role="status">
                {t.common.loading}
              </div>
            }
          >
            <ChannelsPage embedded />
          </Suspense>
        </div>
      </DialogContent>
    </Dialog>
  );
}
